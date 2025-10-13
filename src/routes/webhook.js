// src/routes/webhook.js
// Telegram webhook: тонкий клей над модулями (i18n / tone / energy / brain / statut).
// Клавіатура: Drive, Senti, (Admin — лише адміну). Checklist винесено в Admin-меню.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";

// tone
import { getTone, setTone, toneHint } from "../lib/tone.js";
// i18n
import { getUserLang, tr } from "../lib/i18n.js";
// energy (читаємо конфіг через getEnergy; списуємо через spendEnergy)
import { getEnergy, spendEnergy } from "../lib/energy.js";

// ───────────── helpers ─────────────
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
  await r.text().catch(() => {});
}

function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}
const isBlank = (s) => !s || !String(s).trim();

const BTN_DRIVE = "📁 Drive";
const BTN_SENTI = "🧠 Senti";
const BTN_ADMIN = "🔧 Admin";

const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]); // без Checklist
  return { keyboard: rows, resize_keyboard: true };
};

// інлайн-кнопка на Drive
const inlineOpenDrive = () => ({
  inline_keyboard: [[{ text: "Google Drive", url: "https://drive.google.com/drive/my-drive" }]],
});

// локальні посилання керування енергією
function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

// ───────────── STATE_KV: drive mode ─────────────
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

// ───────────── Dialog memory (легкий) ─────────────
const DIALOG_KEY = (uid) => `dlg:${uid}`;
const DLG_CFG = { maxTurns: 12, maxBytes: 8_000, ttlSec: 14 * 24 * 3600 };
function ensureDialog(env) { return env.DIALOG_KV || null; }
async function readDialog(env, userId) {
  const kv = ensureDialog(env); if (!kv) return [];
  try { const raw = await kv.get(DIALOG_KEY(userId)); if (!raw) return []; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
function trimDialog(arr) {
  let out = Array.isArray(arr) ? arr.slice(-DLG_CFG.maxTurns) : [];
  let s = new TextEncoder().encode(JSON.stringify(out)).length;
  while (out.length > 4 && s > DLG_CFG.maxBytes) { out = out.slice(2); s = new TextEncoder().encode(JSON.stringify(out)).length; }
  return out;
}
async function writeDialog(env, userId, arr) {
  const kv = ensureDialog(env); if (!kv) return false;
  const val = JSON.stringify(trimDialog(arr));
  try { await kv.put(DIALOG_KEY(userId), val, { expirationTtl: DLG_CFG.ttlSec }); return true; } catch { return false; }
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
  const lines = ["[Context: previous dialog (last messages)]"];
  for (const it of turns.slice(-DLG_CFG.maxTurns)) {
    const who = it.r === "user" ? "User" : "Senti";
    lines.push(`${who}: ${it.c}`);
  }
  return lines.join("\n");
}

// ───────────── Self-Tune (опційно) ─────────────
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

    const lines = [];
    if (tone) lines.push(`• User tone: ${tone}.`);
    if (rules.length) {
      lines.push("• Follow these rules:");
      for (const r of rules.slice(0, 5)) lines.push(`  - ${String(r).trim()}`);
    }
    const text = lines.join("\n");
    return text ? `\n\n[Self-Tune]\n${text}\n` : null;
  } catch {
    return null;
  }
}

// ───────────── System hint ─────────────
function langName(l) {
  return { uk: "Ukrainian", ru: "Russian", de: "German", en: "English (US)", fr: "French" }[l] || "English (US)";
}
async function buildSystemHint(env, chatId, userId, lang, extra = "") {
  const statut = await readStatut(env).catch(() => "");
  const selfTune = chatId ? await loadSelfTune(env, chatId) : null;
  const dialogCtx = userId ? await buildDialogHint(env, userId) : "";
  const tone = await toneHint(env, chatId, lang);

  const style =
    `Always reply in ${langName(lang)}.\n` +
    "Prefer a conversational, friendly tone (not formal). Short, clear sentences. Emojis only when natural.";

  const base =
    (statut ? `${statut.trim()}\n\n` : "") +
    "You are Senti, a Telegram assistant. If user asks to save a file — remind about Google Drive and Checklist/Repo.";

  const parts = [base, style, tone, selfTune || "", dialogCtx || "", extra || ""].filter(Boolean);
  return parts.join("\n\n");
}

// ───────────── Media helpers ─────────────
function pickPhoto(msg) {
  const a = msg.photo;
  if (!Array.isArray(a) || !a.length) return null;
  const ph = a[a.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document)  { const d = msg.document;  return { type: "document",  file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` }; }
  if (msg.video)     { const v = msg.video;     return { type: "video",     file_id: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4` }; }
  if (msg.audio)     { const a = msg.audio;     return { type: "audio",     file_id: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3` }; }
  if (msg.voice)     { const v = msg.voice;     return { type: "voice",     file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` }; }
  if (msg.video_note){ const v = msg.video_note;return { type: "video_note", file_id: v.file_id, name: `videonote_${v.file_unique_id}.mp4` }; }
  return pickPhoto(msg);
}
async function tgFileUrl(env, file_id) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  const d = await r.json().catch(() => ({}));
  const path = d?.result?.file_path;
  if (!path) throw new Error("getFile: file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  const { costImage } = await getEnergy(env, userId);
  const curBefore = await getEnergy(env, userId);
  if (curBefore.energy < costImage) {
    const links = energyLinks(env, userId);
    await sendMessage(env, chatId, tr(lang, "energy_not_enough", costImage, links));
    return true;
  }
  await spendEnergy(env, userId, costImage, "media");

  const ut = await getUserTokens(env, userId);
  if (!ut?.refresh_token) {
    const authUrl = abs(env, `/auth/start?u=${userId}`);
    await sendMessage(env, chatId, tr(lang, "drive_auth", authUrl));
    return true;
  }
  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendMessage(env, chatId, tr(lang, "saved_to_drive", saved?.name || att.name));
  return true;
}

// ───────────── main handler ─────────────
export async function handleTelegramWebhook(req, env) {
  // webhook auth
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

  const textRaw =
    update.message?.text || update.edited_message?.text || update.callback_query?.data || "";
  const text = (textRaw || "").trim();
  if (!msg) return json({ ok: true });

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const isAdmin = ADMIN(env, userId);

  // мова користувача
  const lang = await getUserLang(env, userId, msg.from?.language_code, text);

  const safe = async (fn) => {
    try { await fn(); } catch (e) { await sendMessage(env, chatId, tr(lang, "generic_error", String(e))); }
  };

  // /start — тільки дружнє вітання + клавіатура
  if (text === "/start") {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      await sendMessage(env, chatId, tr(lang, "hello"), { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // /tone
  if (text.startsWith("/tone")) {
    await safe(async () => {
      const arg = text.replace(/^\/tone(?:@[\w_]+)?/i, "").trim();
      if (!arg) {
        const cur = await getTone(env, chatId);
        await sendMessage(env, chatId, tr(lang, "tone_current", cur.mode, cur.value, cur.autoLast || ""));
        await sendMessage(env, chatId, tr(lang, "tone_help"));
        return;
      }
      if (/^(help|\?)$/i.test(arg)) { await sendMessage(env, chatId, tr(lang, "tone_help")); return; }
      const ok = await setTone(env, chatId, arg);
      await sendMessage(env, chatId, ok ? tr(lang, "tone_set_ok", arg) : tr(lang, "generic_error", "bad tone value"));
    });
    return json({ ok: true });
  }

  // /diag — only admin
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
      await sendMessage(env, chatId, lines.join("\n"), { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // /ai
  const aiArg = parseAiCommand(textRaw);
  if (aiArg !== null) {
    await safe(async () => {
      const q = aiArg || "";
      if (!q) { await sendMessage(env, chatId, tr(lang, "ai_usage")); return; }

      const { costText, low } = await getEnergy(env, userId);
      const curBefore = await getEnergy(env, userId);
      if (curBefore.energy < costText) {
        const links = energyLinks(env, userId);
        await sendMessage(env, chatId, tr(lang, "energy_not_enough", costText, links));
        return;
      }
      const spent = await spendEnergy(env, userId, costText, "text");

      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let reply = "";
      try {
        if (modelOrder) {
          const merged = `${systemHint}\n\nUser: ${q}`;
          reply = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
        } else {
          reply = await think(env, q, systemHint);
        }
      } catch (e) {
        reply = `🧠 AI error: ${String(e?.message || e)}`;
      }

      if (isBlank(reply)) reply = tr(lang, "ai_usage");

      await pushDialog(env, userId, "user", q);
      await pushDialog(env, userId, "assistant", reply);

      if (spent.energy <= low) {
        const links = energyLinks(env, userId);
        reply += `\n\n${tr(lang, "energy_low_hint", spent.energy, links.energy)}`;
      }
      await sendMessage(env, chatId, reply);
    });
    return json({ ok: true });
  }

  // Drive — тільки кнопка, без текстів
  if (text === BTN_DRIVE) {
    await safe(async () => {
      const ut = await getUserTokens(env, userId);
      if (!ut?.refresh_token) {
        const authUrl = abs(env, `/auth/start?u=${userId}`);
        await sendMessage(env, chatId, tr(lang, "drive_auth", authUrl));
        return;
      }
      await setDriveMode(env, userId, true);
      // мінімальне "порожнє" повідомлення + інлайн-кнопка
      await sendMessage(env, chatId, "\u2060", { reply_markup: inlineOpenDrive() });
    });
    return json({ ok: true });
  }

  // Senti — тихе вимкнення режиму диска
  if (text === BTN_SENTI) {
    await safe(async () => { await setDriveMode(env, userId, false); });
    return json({ ok: true });
  }

  // Admin — інлайн-меню з посиланнями (і повертаємо клавіатуру)
  const sendAdminMenu = async () => {
    const sec = encodeURIComponent(env.WEBHOOK_SECRET || "");
    const cl = abs(env, `/admin/checklist/html?s=${sec}`);
    const repo = abs(env, `/admin/repo/html?s=${sec}`);
    const hook = abs(env, "/webhook");

    const inline = {
      inline_keyboard: [
        [{ text: "📋 Checklist", url: cl }],
        [{ text: "📁 Repo", url: repo }],
        [{ text: "🌐 Webhook GET", url: hook }],
      ],
    };
    await sendMessage(env, chatId, "\u2060", { reply_markup: inline });
  };

  if ((text === BTN_ADMIN || text === "/admin") && isAdmin) {
    await safe(async () => {
      await sendAdminMenu();
      await sendMessage(env, chatId, "\u2060", { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // Drive mode: media
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
    }
  } catch (e) {
    await sendMessage(env, chatId, tr(lang, "generic_error", String(e)));
    return json({ ok: true });
  }

  // Regular text -> AI
  if (text && !text.startsWith("/")) {
    try {
      const { costText, low } = await getEnergy(env, userId);
      const curBefore = await getEnergy(env, userId);
      if (curBefore.energy < costText) {
        const links = energyLinks(env, userId);
        await sendMessage(env, chatId, tr(lang, "energy_not_enough", costText, links));
        return json({ ok: true });
      }
      const spent = await spendEnergy(env, userId, costText, "text");

      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let out = "";

      if (modelOrder) {
        const merged = `${systemHint}\n\nUser: ${text}`;
        out = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
      } else {
        out = await think(env, text, systemHint);
      }

      if (isBlank(out)) out = tr(lang, "ai_usage");

      await pushDialog(env, userId, "user", text);
      await pushDialog(env, userId, "assistant", out);

      if (spent.energy <= low) {
        const links = energyLinks(env, userId);
        out += `\n\n${tr(lang, "energy_low_hint", spent.energy, links.energy)}`;
      }
      await sendMessage(env, chatId, out);
      return json({ ok: true });
    } catch (e) {
      await sendMessage(env, chatId, tr(lang, "ai_usage"));
      return json({ ok: true });
    }
  }

  // default — коротке вітання + клавіатура
  await sendMessage(env, chatId, tr(lang, "hello"), { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}