// Telegram webhook з інтеграцією "мозку" та перевірками доступу/режиму диска.
// Додаємо Статут як системний підказник для AI на кожну текстову взаємодію.
// ⬆️ ДОПОВНЕНО: Self-Tune — підтягувамо інсайти зі STATE_KV і додаємо rules/tone.
// ⬆️ ДОПОВНЕНО: Energy — ліміт витрат на текст/медіа з авто-відновленням.
// ⬆️ ДОПОВНЕНО: Dialog Memory — коротка історія спілкування у DIALOG_KV з TTL.
// ⬆️ ДОПОВНЕНО: /mem show|reset — керування короткою пам’яттю без витрат енергії.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";

// ── helpers ───────────────────────────────────────────────────────────────────
const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });

async function sendMessage(env, chatId, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...extra }),
  });
  await r.text().catch(() => {}); // не валимо весь хендлер, якщо TG вернув помилку
}

// Безпечний парсер команди /ai (підтримує /ai, /ai@Bot, з/без аргументів)
function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim(); // може бути ""
}

// Парсер /mem
function parseMemCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/mem(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  const arg = (m[1] || "").trim();
  if (!arg) return { cmd: "help" };
  const parts = arg.split(/\s+/);
  const sub = parts[0].toLowerCase();
  if (sub === "show") {
    const n = Math.min(50, Math.max(1, Number(parts[1] || 10)));
    return { cmd: "show", n };
  }
  if (sub === "reset") return { cmd: "reset" };
  return { cmd: "help" };
}

// Анти-порожній фолбек + утиліта перевірки
function defaultAiReply() {
  return (
    "🤖 Я можу відповідати на питання, допомагати з кодом, " +
    "зберігати файли на Google Drive (кнопка «Google Drive») " +
    "та керувати чеклистом/репозиторієм. Спробуй запит на тему, яка цікавить!"
  );
}
const isBlank = (s) => !s || !String(s).trim();

const BTN_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";
const BTN_CHECK = "Checklist";

const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }, { text: BTN_CHECK }]);
  return { keyboard: rows, resize_keyboard: true };
};

const inlineOpenDrive = () => ({
  inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]],
});

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

// ── STATE_KV: режим диска ─────────────────────────────────────────────────────
const DRIVE_MODE_KEY = (uid) => `drive_mode:${uid}`;
function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}
async function setDriveMode(env, userId, on) {
  await ensureState(env).put(DRIVE_MODE_KEY(userId), on ? "1" : "0", { expirationTtl: 3600 });
}
async function getDriveMode(env, userId) {
  return (await ensureState(env).get(DRIVE_MODE_KEY(userId))) === "1";
}

// ── Energy subsystem ──────────────────────────────────────────────────────────
const ENERGY_KEY = (uid) => `energy:${uid}`;
function energyCfg(env) {
  return {
    max: Number(env.ENERGY_MAX ?? 100),
    recoverPerMin: Number(env.ENERGY_RECOVER_PER_MIN ?? 1),
    costText: Number(env.ENERGY_COST_TEXT ?? 1),
    costImage: Number(env.ENERGY_COST_IMAGE ?? 5),
    low: Number(env.ENERGY_LOW_THRESHOLD ?? 10),
  };
}

async function getEnergy(env, userId) {
  const cfg = energyCfg(env);
  const raw = await ensureState(env).get(ENERGY_KEY(userId));
  const now = Math.floor(Date.now() / 1000);
  if (!raw) {
    const obj = { v: cfg.max, t: now };
    await ensureState(env).put(ENERGY_KEY(userId), JSON.stringify(obj));
    return obj.v;
  }
  let obj;
  try { obj = JSON.parse(raw); } catch { obj = { v: cfg.max, t: now }; }
  const minutes = Math.floor((now - (obj.t || now)) / 60);
  if (minutes > 0 && obj.v < cfg.max) {
    obj.v = Math.min(cfg.max, obj.v + minutes * cfg.recoverPerMin);
    obj.t = now;
    await ensureState(env).put(ENERGY_KEY(userId), JSON.stringify(obj));
  }
  return obj.v;
}

async function setEnergy(env, userId, v) {
  const now = Math.floor(Date.now() / 1000);
  await ensureState(env).put(ENERGY_KEY(userId), JSON.stringify({ v, t: now }));
  return v;
}

async function spendEnergy(env, userId, cost) {
  const cfg = energyCfg(env);
  const cur = await getEnergy(env, userId);
  if (cur < cost) return { ok: false, cur, need: cost, cfg };
  const left = Math.max(0, cur - cost);
  await setEnergy(env, userId, left);
  return { ok: true, cur: left, cfg };
}

function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

// ── Dialog Memory (DIALOG_KV) ────────────────────────────────────────────────
// Зберігаємо останні ходи діалогу користувача з ботом.
// Обмеження: maxTurns та maxBytes запобігають розростанню.
// TTL: 14 днів неактивності — запис зникне автоматично.
const DIALOG_KEY = (uid) => `dlg:${uid}`;
const DLG_CFG = {
  maxTurns: 12,          // скільки повідомлень тримати (user+assistant разом)
  maxBytes: 8_000,       // максимальний розмір JSON-рядка
  ttlSec: 14 * 24 * 3600 // 14 днів
};
function ensureDialog(env) {
  return env.DIALOG_KV || null;
}
async function readDialog(env, userId) {
  const kv = ensureDialog(env);
  if (!kv) return [];
  try {
    const raw = await kv.get(DIALOG_KEY(userId));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function trimDialog(arr) {
  let out = Array.isArray(arr) ? arr.slice(-DLG_CFG.maxTurns) : [];
  // якщо перевищили байти — жорсткіше ріжемо з початку
  let s = new TextEncoder().encode(JSON.stringify(out)).length;
  while (out.length > 4 && s > DLG_CFG.maxBytes) {
    out = out.slice(2); // відсікаємо найстарші 2 записи
    s = new TextEncoder().encode(JSON.stringify(out)).length;
  }
  return out;
}
async function writeDialog(env, userId, arr) {
  const kv = ensureDialog(env);
  if (!kv) return false;
  const val = JSON.stringify(trimDialog(arr));
  try {
    await kv.put(DIALOG_KEY(userId), val, { expirationTtl: DLG_CFG.ttlSec });
    return true;
  } catch {
    return false;
  }
}
async function pushDialog(env, userId, role, content) {
  const now = Date.now();
  const arr = await readDialog(env, userId);
  arr.push({ r: role, c: String(content || "").slice(0, 1500), t: now });
  return await writeDialog(env, userId, arr);
}
async function buildDialogHint(env, userId) {
  const turns = await readDialog(env, userId);
  if (!turns.length) return "";
  // Формуємо короткий readable-хінт
  const lines = ["[Context: попередній діалог (останні повідомлення)]"];
  for (const it of turns.slice(-DLG_CFG.maxTurns)) {
    const who = it.r === "user" ? "Користувач" : "Senti";
    lines.push(`${who}: ${it.c}`);
  }
  return lines.join("\n");
}

// ── Self-Tune: підтягування інсайтів зі STATE_KV ─────────────────────────────
async function loadSelfTune(env, chatId) {
  try {
    if (!env.STATE_KV) return null;
    const key = `insight:latest:${chatId}`;
    const raw = await env.STATE_KV.get(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const rules = Array.isArray(obj?.analysis?.rules) ? obj.analysis.rules : [];
    const tone  = obj?.analysis?.tone ? String(obj.analysis.tone).trim() : "";

    if (!rules.length && !tone) return null;

    // Будуємо короткий блок політик для системного хінта
    const lines = [];
    if (tone) lines.push(`• Тон розмови користувача: ${tone}.`);
    if (rules.length) {
      lines.push("• Дотримуйся правил:");
      for (const r of rules.slice(0, 5)) {
        lines.push(`  - ${String(r).trim()}`);
      }
    }
    const text = lines.join("\n");
    return text ? `\n\n[Self-Tune]\n${text}\n` : null;
  } catch {
    return null;
  }
}

// Збір системного підказника (Статут + Self-Tune + базова інструкція + Діалог)
async function buildSystemHint(env, chatId, userId, extra = "") {
  const statut = await readStatut(env).catch(() => "");
  const selfTune = chatId ? await loadSelfTune(env, chatId) : null;
  const dialogCtx = userId ? await buildDialogHint(env, userId) : "";

  const base =
    (statut ? `${statut.trim()}\n\n` : "") +
    "Ти — Senti, помічник у Telegram. Відповідай стисло та дружньо. " +
    "Якщо просять зберегти файл — нагадай про Google Drive та розділ Checklist/Repo.";

  const parts = [base, selfTune || "", dialogCtx || "", extra || ""].filter(Boolean);
  return parts.join("\n\n");
}

// ── медіа ─────────────────────────────────────────────────────────────────────
function pickPhoto(msg) {
  const a = msg.photo;
  if (!Array.isArray(a) || !a.length) return null;
  const ph = a[a.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document) {
    const d = msg.document;
    return { type: "document", file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` };
  }
  if (msg.video) {
    const v = msg.video;
    return { type: "video", file_id: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4` };
  }
  if (msg.audio) {
    const a = msg.audio;
    return { type: "audio", file_id: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3` };
  }
  if (msg.voice) {
    const v = msg.voice;
    return { type: "voice", file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` };
  }
  if (msg.video_note) {
    const v = msg.video_note;
    return { type: "video_note", file_id: v.file_id, name: `videonote_${v.file_unique_id}.mp4` };
  }
  return pickPhoto(msg);
}
async function tgFileUrl(env, file_id) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  const d = await r.json().catch(() => ({}));
  const path = d?.result?.file_path;
  if (!path) throw new Error("getFile: file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}

async function handleIncomingMedia(env, chatId, userId, msg) {
  const att = detectAttachment(msg);
  if (!att) return false;

  // energy check for media
  const { costImage } = energyCfg(env);
  const spend = await spendEnergy(env, userId, costImage);
  if (!spend.ok) {
    const links = energyLinks(env, userId);
    await sendMessage(
      env,
      chatId,
      `🔋 Недостатньо енергії для збереження медіа (потрібно ${costImage}).\n` +
      `Відновлюйся автоматично, або керуй тут:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`
    );
    return true;
  }

  const ut = await getUserTokens(env, userId);
  if (!ut?.refresh_token) {
    const authUrl = abs(env, `/auth/start?u=${userId}`);
    await sendMessage(
      env,
      chatId,
      `Щоб зберігати у свій Google Drive — спочатку дозволь доступ:\n${authUrl}\n\nПотім натисни «${BTN_DRIVE}» ще раз.`
    );
    return true;
  }
  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendMessage(env, chatId, `✅ Збережено на твоєму диску: ${saved?.name || att.name}`);
  return true;
}

// ── головний обробник вебхуку ────────────────────────────────────────────────
export async function handleTelegramWebhook(req, env) {
  // захист секретом Telegram webhook
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    // GET /webhook — сигнал alive
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false }, { status: 400 });
  }

  const msg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.callback_query?.message;

  const textRaw =
    update.message?.text || update.edited_message?.text || update.callback_query?.data || "";
  const text = (textRaw || "").trim();
  if (!msg) return json({ ok: true });

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const isAdmin = ADMIN(env, userId);

  const safe = async (fn) => {
    try { await fn(); } catch (e) { await sendMessage(env, chatId, `❌ Помилка: ${String(e)}`); }
  };

  // /start
  if (text === "/start") {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      await sendMessage(env, chatId, "Привіт! Я Senti 🤖", { reply_markup: mainKeyboard(isAdmin) });
      // нульовий запис діалогу не створюємо — з’явиться після першого повідомлення
    });
    return json({ ok: true });
  }

  // /diag — коротка діагностика (тільки для адміна)
  if (text === "/diag" && isAdmin) {
    await safe(async () => {
      const hasGemini   = !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
      const hasCF       = !!(env.CF_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
      const hasOR       = !!env.OPENROUTER_API_KEY;
      const hasFreeBase = !!env.FREE_API_BASE_URL;
      const hasFreeKey  = !!env.FREE_API_KEY;
      const mo = String(env.MODEL_ORDER || "").trim();

      const lines = [
        "🧪 Діагностика AI",
        `MODEL_ORDER: ${mo || "(порожньо)"}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${hasCF ? "✅" : "❌"}`,
        `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
      ];

      // Health summary (EWMA, fail streak, cooldown)
      const entries = mo ? mo.split(",").map(s => s.trim()).filter(Boolean) : [];
      if (entries.length) {
        const health = await getAiHealthSummary(env, entries);
        lines.push("\n— Health:");
        for (const h of health) {
          const light = h.cool ? "🟥" : (h.slow ? "🟨" : "🟩");
          const ms = h.ewmaMs ? `${Math.round(h.ewmaMs)}ms` : "n/a";
          lines.push(`${light} ${h.provider}:${h.model} — ewma ${ms}, fails ${h.failStreak || 0}`);
        }
      }

      await sendMessage(env, chatId, lines.join("\n"));
    });
    return json({ ok: true });
  }

  // /mem — керування пам’яттю (без витрат енергії)
  const memCmd = parseMemCommand(textRaw);
  if (memCmd) {
    await safe(async () => {
      if (memCmd.cmd === "show") {
        const arr = await readDialog(env, userId);
        if (!arr.length) {
          await sendMessage(env, chatId, "🧠 Пам’ять порожня.");
          return;
        }
        const last = arr.slice(-memCmd.n);
        const lines = ["🧠 Останні записи:"];
        for (const it of last) {
          const who = it.r === "user" ? "Користувач" : "Senti";
          lines.push(`${who}: ${it.c}`);
        }
        await sendMessage(env, chatId, lines.join("\n"));
        return;
      }
      if (memCmd.cmd === "reset") {
        await writeDialog(env, userId, []);
        await sendMessage(env, chatId, "🧽 Пам’ять чату очищено.");
        return;
      }
      await sendMessage(
        env,
        chatId,
        "Команди /mem:\n• /mem show [N] — показати останні N (дефолт 10)\n• /mem reset — очистити пам’ять"
      );
    });
    return json({ ok: true });
  }

  // /ai (надійний парсинг: /ai, /ai@Bot, з/без аргументів)
  const aiArg = parseAiCommand(textRaw);
  if (aiArg !== null) {
    await safe(async () => {
      const q = aiArg || "";
      if (!q) {
        await sendMessage(
          env,
          chatId,
          "✍️ Надішли запит після команди /ai. Приклад:\n/ai Скільки буде 2+2?",
          { parse_mode: undefined }
        );
        return;
      }

      // енергія для тексту
      const { costText, low } = energyCfg(env);
      const spent = await spendEnergy(env, userId, costText);
      if (!spent.ok) {
        const links = energyLinks(env, userId);
        await sendMessage(
          env,
          chatId,
          `🔋 Не вистачає енергії (потрібно ${costText}).\n` +
          `Вона відновлюється автоматично.\n` +
          `Керування:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`
        );
        return;
      }

      // ⬇️ Self-Tune + Статут + Контекст діалогу як системний хінт
      const systemHint = await buildSystemHint(env, chatId, userId);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let reply = "";
      try {
        if (modelOrder) {
          const merged = `${systemHint}\n\nКористувач: ${q}`;
          reply = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
        } else {
          reply = await think(env, q, systemHint);
        }
      } catch (e) {
        reply = `🧠 Помилка AI: ${String(e?.message || e)}`;
      }

      if (isBlank(reply)) reply = defaultAiReply();

      // Зберігаємо діалог
      await pushDialog(env, userId, "user", q);
      await pushDialog(env, userId, "assistant", reply);

      // low-mode підказка
      if (spent.cur <= low) {
        const links = energyLinks(env, userId);
        reply += `\n\n⚠️ Низький рівень енергії (${spent.cur}). Відновиться автоматично. Керування: ${links.energy}`;
      }
      await sendMessage(env, chatId, reply, { parse_mode: undefined });
    });
    return json({ ok: true });
  }

  // Кнопка Google Drive
  if (text === BTN_DRIVE) {
    await safe(async () => {
      const ut = await getUserTokens(env, userId);
      if (!ut?.refresh_token) {
        const authUrl = abs(env, `/auth/start?u=${userId}`);
        await sendMessage(
          env,
          chatId,
          `Дай доступ до свого Google Drive:\n${authUrl}\n\nПісля дозволу повернись у чат і ще раз натисни «${BTN_DRIVE}».`
        );
        return;
      }
      await setDriveMode(env, userId, true);
      await sendMessage(env, chatId, "📁 Режим диска: ON\nНадсилай фото/відео/документи — збережу на твій Google Drive.", {
        reply_markup: mainKeyboard(isAdmin),
      });
      await sendMessage(env, chatId, "Переглянути вміст диска:", { reply_markup: inlineOpenDrive() });
    });
    return json({ ok: true });
  }

  // Кнопка Senti (вимкнути режим диска)
  if (text === BTN_SENTI) {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      await sendMessage(env, chatId, "Режим диска вимкнено. Це звичайний чат Senti.", {
        reply_markup: mainKeyboard(isAdmin),
      });
    });
    return json({ ok: true });
  }

  // Декілька базових адмін-дій прямо з чату (посилання на HTML-панелі)
  if (text === BTN_CHECK && isAdmin) {
    await safe(async () => {
      const link = abs(env, `/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
      await sendMessage(env, chatId, `📋 Чеклист (HTML):\n${link}`);
    });
    return json({ ok: true });
  }

  if ((text === "Admin" || text === "/admin") && isAdmin) {
    await safe(async () => {
      const cl = abs(env, `/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
      const repo = abs(env, `/admin/repo/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
      await sendMessage(
        env,
        chatId,
        `🛠 Адмін-меню\n\n• Чеклист: ${cl}\n• Repo: ${repo}\n• Вебхук GET: ${abs(env, "/webhook")}`
      );
    });
    return json({ ok: true });
  }

  // Якщо увімкнено режим диска — перехоплюємо та зберігаємо медіа (зі списанням енергії)
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg)) return json({ ok: true });
    }
  } catch (e) {
    await sendMessage(env, chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`);
    return json({ ok: true });
  }

  // Якщо це не команда і не медіа — відповідаємо AI з підвантаженням Статуту + Self-Tune + Діалогу
  if (text && !text.startsWith("/")) {
    try {
      // списання енергії для звичайного тексту
      const { costText, low } = energyCfg(env);
      const spent = await spendEnergy(env, userId, costText);
      if (!spent.ok) {
        const links = energyLinks(env, userId);
        await sendMessage(
          env,
          chatId,
          `🔋 Не вистачає енергії (потрібно ${costText}). Відновлення авто.\n` +
          `Energy: ${links.energy}`
        );
        return json({ ok: true });
      }

      const systemHint = await buildSystemHint(env, chatId, userId);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let out = "";

      if (modelOrder) {
        const merged = `${systemHint}\n\nКористувач: ${text}`;
        out = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
      } else {
        out = await think(env, text, systemHint);
      }

      if (isBlank(out)) out = defaultAiReply();

      // Зберігаємо діалог
      await pushDialog(env, userId, "user", text);
      await pushDialog(env, userId, "assistant", out);

      if (spent.cur <= low) {
        const links = energyLinks(env, userId);
        out += `\n\n⚠️ Низький рівень енергії (${spent.cur}). Керування: ${links.energy}`;
      }
      await sendMessage(env, chatId, out, { parse_mode: undefined });
      return json({ ok: true });
    } catch (e) {
      await sendMessage(env, chatId, defaultAiReply(), { parse_mode: undefined });
      return json({ ok: true });
    }
  }

  // дефолт
  await sendMessage(env, chatId, "Чіназес 👋", { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}