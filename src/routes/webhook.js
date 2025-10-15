import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { sendMessage } from "../lib/telegram.js";

function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}
function defaultAiReply() {
  return "Вибач, зараз не готовий відповісти чітко. Спробуй переформулювати або дай більше контексту.";
}
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

// ── Energy (тимчасово локально; винесемо на Кроці 2) ─────────────────────────
function energyCfg(env) {
  return {
    max: Number(env.ENERGY_MAX ?? 100),
    recoverPerMin: Number(env.ENERGY_RECOVER_PER_MIN ?? 1),
    costText: Number(env.ENERGY_COST_TEXT ?? 1),
    costImage: Number(env.ENERGY_COST_IMAGE ?? 5),
    low: Number(env.ENERGY_LOW_THRESHOLD ?? 10),
  };
}
const ENERGY_KEY = (uid) => `energy:${uid}`;
async function getEnergy(env, userId) {
  const kv = ensureState(env);
  const raw = await kv.get(ENERGY_KEY(userId));
  const cfg = energyCfg(env);
  if (!raw) {
    const rec = { v: cfg.max, ts: Date.now() };
    await kv.put(ENERGY_KEY(userId), JSON.stringify(rec));
    return cfg.max;
  }
  const rec = JSON.parse(raw);
  const mins = Math.floor((Date.now() - (rec.ts || 0)) / 60000);
  if (mins > 0 && cfg.recoverPerMin > 0) {
    const add = mins * cfg.recoverPerMin;
    const v2 = Math.max(0, Math.min(cfg.max, (rec.v ?? cfg.max) + add));
    if (v2 !== rec.v) {
      await kv.put(ENERGY_KEY(userId), JSON.stringify({ v: v2, ts: Date.now() }));
      return v2;
    }
  }
  return rec.v ?? cfg.max;
}
async function setEnergy(env, userId, v) {
  await ensureState(env).put(ENERGY_KEY(userId), JSON.stringify({ v, ts: Date.now() }));
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

// ── Dialog Memory ────────────────────────────────────────────────────────────
const DIALOG_KEY = (uid) => `dlg:${uid}`;
const DLG_CFG = { maxTurns: 12, maxBytes: 8000, ttlSec: 14 * 24 * 3600 };
function ensureDialog(env) {
  if (!env.DIALOG_KV) throw new Error("DIALOG_KV binding missing");
  return env.DIALOG_KV;
}
async function readDialog(env, userId) {
  const kv = ensureDialog(env);
  const raw = await kv.get(DIALOG_KEY(userId));
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}
async function writeDialog(env, userId, arr) {
  const kv = ensureDialog(env);
  const s = JSON.stringify(arr);
  if (s.length > DLG_CFG.maxBytes) {
    const over = s.length - DLG_CFG.maxBytes;
    const drop = Math.ceil((over / s.length) * arr.length) + 1;
    arr = arr.slice(drop);
  }
  await kv.put(DIALOG_KEY(userId), JSON.stringify(arr), { expirationTtl: DLG_CFG.ttlSec });
}
async function pushTurn(env, userId, role, content) {
  const arr = await readDialog(env, userId);
  arr.push({ r: role, c: String(content || "") });
  if (arr.length > DLG_CFG.maxTurns) arr.splice(0, arr.length - DLG_CFG.maxTurns);
  await writeDialog(env, userId, arr);
}
async function buildDialogHint(env, userId) {
  const turns = await readDialog(env, userId);
  if (!turns.length) return "";
  const lines = ["[Context: попередній діalog]"];
  for (const it of turns.slice(-DLG_CFG.maxTurns)) {
    const who = it.r === "user" ? "Користувач" : "Senti";
    lines.push(`${who}: ${it.c}`);
  }
  return lines.join("\n");
}

// ── Self-Tune ────────────────────────────────────────────────────────────────
async function loadSelfTune(env, chatId) {
  try {
    if (!env.STATE_KV) return null;
    const raw = await env.STATE_KV.get(`insight:latest:${chatId}`);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const rules = Array.isArray(obj?.analysis?.rules) ? obj.analysis.rules : [];
    const tone  = obj?.analysis?.tone ? String(obj.analysis.tone).trim() : "";
    if (!rules.length && !tone) return null;
    const lines = [];
    if (tone) lines.push(`• Тон розмови користувача: ${tone}.`);
    if (rules.length) {
      lines.push("• Політики/звички користувача:");
      for (const r of rules.slice(0, 8)) lines.push(`  – ${r}`);
    }
    return lines.join("\n");
  } catch { return null; }
}
async function buildSystemHint(env, chatId, userId) {
  const statut = String(await readStatut(env) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId);
  const blocks = [];
  if (statut) blocks.push(`[Статут/чеклист]\n${statut}`);
  if (tune) blocks.push(`[Self-Tune]\n${tune}`);
  if (dlg) blocks.push(dlg);
  return blocks.length ? blocks.join("\n\n") : "";
}

// ── media helpers ────────────────────────────────────────────────────────────
function pickPhoto(msg) {
  const arr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!arr?.length) return null;
  const ph = arr[arr.length - 1];
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
  const data = await r.json().catch(() => null);
  if (!data?.ok) throw new Error("getFile failed");
  const path = data.result?.file_path;
  if (!path) throw new Error("file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}
async function handleIncomingMedia(env, chatId, userId, msg) {
  const att = detectAttachment(msg);
  if (!att) return false;
  const { costImage, low } = energyCfg(env);
  const spent = await spendEnergy(env, userId, costImage);
  if (!spent.ok) {
    const links = energyLinks(env, userId);
    await sendMessage(env, chatId, `🔋 Не вистачає енергії для збереження медіа (потрібно ${costImage}).\nEnergy: ${links.energy}`);
    return true;
  }
  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendMessage(env, chatId, `✅ Збережено на твоєму диску: ${saved?.name || att.name}`);
  return true;
}

// ── ГОЛОВНИЙ ОБРОБНИК ────────────────────────────────────────────────────────
export async function handleTelegramWebhook(req, env) {
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  let update;
  try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }

  const msg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.callback_query?.message;

  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;
  const userId = msg?.from?.id || update?.callback_query?.from?.id;
  const isAdmin = String(userId) === String(env.TELEGRAM_ADMIN_ID);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const text = textRaw;

  // 🧪 ДЕБАГ: підтверджуємо, що хук працює і відправка теж
  try { if (chatId) await sendMessage(env, chatId, "🧪 Пінг"); } catch {}

  const safe = async (fn) => { try { await fn(); } catch { try { await sendMessage(env, chatId, "Внутрішня помилка. Спробуй пізніше."); } catch {} } };

  if (text === "/admin" || text === "/admin@SentiBot") {
    await safe(async () => {
      if (!isAdmin) { await sendMessage(env, chatId, "Доступ заборонено."); return; }
      const mo = String(env.MODEL_ORDER || "").trim();
      const hasGemini = !!env.GOOGLE_GEMINI_API_KEY;
      const hasCF = !!env.CLOUDFLARE_API_TOKEN && !!env.CF_ACCOUNT_ID;
      const hasOR = !!env.OPENROUTER_API_KEY;
      const hasFreeBase = !!env.FREE_LLM_BASE_URL;
      const hasFreeKey = !!env.FREE_LLM_API_KEY;

      const lines = [
        "Адмін-панель (швидка діагностика):",
        `MODEL_ORDER: ${mo || "(not set)"}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${hasCF ? "✅" : "❌"}`,
        `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
      ];

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

  const aiArg = parseAiCommand(textRaw);
  if (aiArg !== null) {
    await safe(async () => {
      const q = aiArg || "";
      if (!q) {
        await sendMessage(env, chatId, "Напиши запит після /ai, або просто відправ текст без команди — я відповім як зазвичай.");
        return;
      }
      const { costText, low } = energyCfg(env);
      const spent = await spendEnergy(env, userId, costText);
      if (!spent.ok) {
        const links = energyLinks(env, userId);
        await sendMessage(env, chatId, `🔋 Не вистачає енергії (потрібно ${costText}). Відновлення авто.\nEnergy: ${links.energy}`);
        return;
      }
      const systemHint = await buildSystemHint(env, chatId, userId);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      const out = modelOrder ? await askAnyModel(env, modelOrder, q, { systemHint }) : await think(env, q, { systemHint });
      await pushTurn(env, userId, "user", q);
      await pushTurn(env, userId, "assistant", out);
      let reply = out;
      if (spent.cur <= low) {
        const links = energyLinks(env, userId);
        reply += `\n\n⚠️ Низький рівень енергії (${spent.cur}). Відновиться автоматично. Керування: ${links.energy}`;
      }
      await sendMessage(env, chatId, reply, { parse_mode: undefined });
    });
    return json({ ok: true });
  }

  if (text === BTN_DRIVE) {
    await safe(async () => {
      const ut = await getUserTokens(env, userId);
      if (!ut?.refresh_token) {
        const authUrl = abs(env, `/auth/start?u=${userId}`);
        await sendMessage(env, chatId, `Дай доступ до свого Google Drive:\n${authUrl}\n\nПісля дозволу повернись у чат і ще раз натисни «${BTN_DRIVE}».`);
        return;
      }
      await setDriveMode(env, userId, true);
      await sendMessage(env, chatId, "📁 Режим диска: ON\nНадсилай фото/відео/документи — збережу на твій Google Drive.", { reply_markup: mainKeyboard(isAdmin) });
      await sendMessage(env, chatId, "Переглянути вміст диска:", { reply_markup: inlineOpenDrive() });
    });
    return json({ ok: true });
  }

  if (text === BTN_SENTI || text === BTN_ADMIN || text === BTN_CHECK) {
    // залишаємо місце для додаткових кнопок
  }

  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg)) return json({ ok: true });
    }
  } catch (e) {
    await sendMessage(env, chatId, `❌ Не вдалось зберегти вкладення: ${String(e)}`);
    return json({ ok: true });
  }

  if (text && !text.startsWith("/")) {
    try {
      const { costText, low } = energyCfg(env);
      const spent = await spendEnergy(env, userId, costText);
      if (!spent.ok) {
        const links = energyLinks(env, userId);
        await sendMessage(env, chatId, `🔋 Не вистачає енергії (потрібно ${costText}). Відновлення авто.\nEnergy: ${links.energy}`);
        return json({ ok: true });
      }
      const systemHint = await buildSystemHint(env, chatId, userId);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let out = modelOrder ? await askAnyModel(env, modelOrder, text, { systemHint }) : await think(env, text, { systemHint });
      await pushTurn(env, userId, "user", text);
      await pushTurn(env, userId, "assistant", out);
      if (spent.cur <= low) {
        const links = energyLinks(env, userId);
        out += `\n\n⚠️ Низький рівень енергії (${spent.cur}). Керування: ${links.energy}`;
      }
      await sendMessage(env, chatId, out, { parse_mode: undefined });
      return json({ ok: true });
    } catch {
      await sendMessage(env, chatId, defaultAiReply(), { parse_mode: undefined });
      return json({ ok: true });
    }
  }

  await sendMessage(env, chatId, "Чіназес 👋", { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}
