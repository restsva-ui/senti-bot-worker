// Telegram webhook з інтеграцією "мозку" та перевірками доступу/режиму диска.
// Додаємо Статут як системний підказник для AI на кожну текстову взаємодію.
// ⬆️ ДОПОВНЕНО: Self-Tune — підтягувамо інсайти зі STATE_KV і додаємо rules/tone.
// ⬆️ НОВЕ: Енергомодель (getEnergy/spendEnergy) + "low-mode" при низькій енергії.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { getEnergy, spendEnergy } from "../lib/energy.js"; // ← додано

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
const BTN_ENERGY = "Energy"; // ← додано

const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }, { text: BTN_CHECK }, { text: BTN_ENERGY }]); // ← додано
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

// ── Енергомодель: формуємо доповнення до системного хінта при low-mode ──────
function lowModeHint(energy, cfg) {
  return (
    `\n\n[Energy]\n` +
    `• Енергія користувача низька (${energy}/${cfg.MAX}). ` +
    `Відповідай максимально коротко: 2–3 речення, без зайвої води, ` +
    `пріоритезуй дієві інструкції та один конкретний наступний крок.`
  );
}

// Збір системного підказника (Статут + Self-Tune + базова інструкція + (опц.) Energy)
async function buildSystemHint(env, chatId, extra = "", energyBlock = "") {
  const statut = await readStatut(env).catch(() => "");
  const selfTune = chatId ? await loadSelfTune(env, chatId) : null;

  const base =
    (statut ? `${statut.trim()}\n\n` : "") +
    "Ти — Senti, помічник у Telegram. Відповідай стисло та дружньо. " +
    "Якщо просять зберегти файл — нагадай про Google Drive та розділ Checklist/Repo.";

  return base + (selfTune || "") + energyBlock + (extra ? `\n\n${extra}` : "");
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

  // списуємо енергію за медіа
  let energyInfo = null;
  try {
    energyInfo = await spendEnergy(env, userId, "image");
  } catch {}

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

  const suffix =
    energyInfo && energyInfo.energy !== undefined
      ? `\n⚡ Енергія: ${energyInfo.energy}/${energyInfo.cfg?.MAX ?? "?"}`
      : "";
  await sendMessage(env, chatId, `✅ Збережено на твоєму диску: ${saved?.name || att.name}${suffix}`);
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

      let energyLine = "";
      try {
        const eNow = await getEnergy(env, userId);
        energyLine = `\n⚡ Енергія: ${eNow}/${Number(env.ENERGY_MAX || 100)}`;
      } catch {}

      const lines = [
        "🧪 Діагностика AI",
        `MODEL_ORDER: ${mo || "(порожньо)"}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${hasCF ? "✅" : "❌"}`,
        `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
        energyLine,
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

  // /energy — швидкий доступ до панелі енергії
  if (text === "/energy" || text === BTN_ENERGY) { // ← додано
    await safe(async () => {
      const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
      const u = encodeURIComponent(userId);
      const panel = abs(env, `/admin/energy/html?s=${s}&u=${u}`);
      const combo = abs(env, `/admin/checklist/with-energy/html?s=${s}&u=${u}`);
      let snapshot = "";
      try {
        const cur = await getEnergy(env, userId);
        snapshot = `\nПоточна енергія: ${cur}/${Number(env.ENERGY_MAX || 100)}`;
      } catch {}
      await sendMessage(
        env,
        chatId,
        `⚡ Energy панель:\n${panel}\n\n🧩 Checklist+Energy:\n${combo}${snapshot}`
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

      // списання енергії за текстову подію
      let energyBlock = "";
      try {
        const { energy, lowMode, cfg } = await spendEnergy(env, userId, "text");
        if (lowMode) energyBlock = lowModeHint(energy, cfg);
      } catch {}

      // ⬇️ Self-Tune + Статут + (опц.) Energy як системний хінт
      const systemHint = await buildSystemHint(env, chatId, "", energyBlock);

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

      if (isBlank(reply)) reply = defaultAiReply(); // анти-порожній фолбек
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
      const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
      const cl = abs(env, `/admin/checklist/html?s=${s}`);
      const repo = abs(env, `/admin/repo/html?s=${s}`);
      const energy = abs(env, `/admin/energy/html?s=${s}&u=${encodeURIComponent(userId)}`);
      const combo  = abs(env, `/admin/checklist/with-energy/html?s=${s}&u=${encodeURIComponent(userId)}`);
      await sendMessage(
        env,
        chatId,
        `🛠 Адмін-меню\n\n• Чеклист: ${cl}\n• Repo: ${repo}\n• Energy: ${energy}\n• Checklist+Energy: ${combo}\n• Вебхук GET: ${abs(env, "/webhook")}`
      );
    });
    return json({ ok: true });
  }

  // Якщо увімкнено режим диска — перехоплюємо та зберігаємо медіа (і списуємо енергію)
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg)) return json({ ok: true });
    }
  } catch (e) {
    await sendMessage(env, chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`);
    return json({ ok: true });
  }

  // Якщо це не команда і не медіа — відповідаємо AI з підвантаженням Статуту + Self-Tune + (опц.) Energy
  if (text && !text.startsWith("/")) {
    try {
      // списання енергії за текстову подію
      let energyBlock = "";
      try {
        const { energy, lowMode, cfg } = await spendEnergy(env, userId, "text");
        if (lowMode) energyBlock = lowModeHint(energy, cfg);
      } catch {}

      const systemHint = await buildSystemHint(env, chatId, "", energyBlock);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let out = "";

      if (modelOrder) {
        const merged = `${systemHint}\n\nКористувач: ${text}`;
        out = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
      } else {
        out = await think(env, text, systemHint);
      }

      if (isBlank(out)) out = defaultAiReply(); // анти-порожній фолбек
      await sendMessage(env, chatId, out, { parse_mode: undefined });
      return json({ ok: true });
    } catch (e) {
      await sendMessage(env, chatId, defaultAiReply(), { parse_mode: undefined });
      return json({ ok: true });
    }
  }

  // дефолт
  await sendMessage(env, chatId, "Готовий 👋", { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}
