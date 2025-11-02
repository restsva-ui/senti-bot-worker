// src/routes/webhook.js  (part 1/6)
// Telegram webhook + lightweight photo memory + robust vision flow.
// Requires: DEDUP_KV, STATE_KV, DIALOG_KV, ENERGY_* vars; flows/visionDescribe.js

import { describeImage } from "../flows/visionDescribe.js";
import { askText } from "../lib/modelRouter.js";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function ok(data) { return new Response(JSON.stringify(data || { ok: true }), { headers: JSON_HEADERS }); }
function bad(status, msg) { return new Response(JSON.stringify({ ok:false, error: msg }), { status, headers: JSON_HEADERS }); }

function tgApiUrl(token, method) { return `https://api.telegram.org/bot${token}/${method}`; }
async function tgCall(env, method, body) {
  const r = await fetch(tgApiUrl(env.TELEGRAM_BOT_TOKEN, method), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(`TG ${method} failed: ${r.status} ${r.statusText}`);
  return j.result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Short-lived “photo memory” per chat (last N images and their descriptions).
// Stored in DIALOG_KV under key dialog:<chatId>:photos
const PHOTO_MEM_KEY = (chatId) => `dialog:${chatId}:photos`;
const PHOTO_MEM_LIMIT = 5; // last 5 photos per chat

async function loadPhotoMem(env, chatId) {
  try {
    const raw = await env.DIALOG_KV.get(PHOTO_MEM_KEY(chatId));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
async function savePhotoMem(env, chatId, item) {
  const list = await loadPhotoMem(env, chatId);
  const out = [{ ...item, ts: Date.now() }, ...list].slice(0, PHOTO_MEM_LIMIT);
  await env.DIALOG_KV.put(PHOTO_MEM_KEY(chatId), JSON.stringify(out), { expirationTtl: 60 * 60 * 24 * 14 }); // 14 d
  return out;
}

// Basic energy budget so vision/text не виснажує воркер після деплою
async function getEnergy(env, chatId) {
  const key = `energy:${chatId}`;
  const max = Number(env.ENERGY_MAX || 100);
  const rec = Number(env.ENERGY_RECOVER_PER_MIN || 1);
  const low = Number(env.ENERGY_LOW_THRESHOLD || 10);
  const now = Date.now();
  const raw = await env.STATE_KV.get(key);
  let val = max, ts = now;
  if (raw) { try { ({ val, ts } = JSON.parse(raw)); } catch {} }
  // recover
  const mins = Math.floor((now - (ts || now)) / 60000);
  val = Math.min(max, val + mins * rec);
  return { val, low, now, key };
}
async function spendEnergy(env, e, cost) {
  const val = Math.max(0, e.val - cost);
  await env.STATE_KV.put(e.key, JSON.stringify({ val, ts: e.now }));
  return val;
}
// src/routes/webhook.js  (part 2/6)

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function chatIdFromUpdate(upd) {
  if (upd.message?.chat?.id) return upd.message.chat.id;
  if (upd.callback_query?.message?.chat?.id) return upd.callback_query.message.chat.id;
  if (upd.edited_message?.chat?.id) return upd.edited_message.chat.id;
  return null;
}
function tgLangFromUpdate(upd) {
  return (
    upd.message?.from?.language_code ||
    upd.callback_query?.from?.language_code ||
    upd.edited_message?.from?.language_code ||
    "uk"
  );
}

function extractPhotoBest(message) {
  const ph = message?.photo;
  if (!Array.isArray(ph) || ph.length === 0) return null;
  // take biggest
  return ph[ph.length - 1];
}

async function getFileUrl(env, fileId) {
  const info = await tgCall(env, "getFile", { file_id: fileId });
  const path = info?.file_path;
  if (!path) throw new Error("no file_path");
  // public download URL
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`;
}

async function fetchAsBase64(url) {
  const r = await fetch(url);
  const ab = await r.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)));
  return `data:image/jpeg;base64,${b64}`;
}

// compact icon link for Maps (we send only an icon + short link is generated inside describeImage)
function withMapIcon(text) {
  // already formatted in describeImage like: "— ↗︎ https://maps.app.goo.gl/?q=..."
  // here we replace the URL with a single icon link [↗︎](URL)
  return text.replace(/—\s*↗︎\s*(https?:\/\/\S+)/g, (m, url) => `— [↗︎](${url})`);
}

function sanitizeAnswer(s) {
  return String(s || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
// src/routes/webhook.js  (part 3/6)

// ─────────────────────────────────────────────────────────────────────────────
// Handlers

async function handleAdmin(env, chatId) {
  const order = String(env.MODEL_ORDER || "");
  const moText = String(env.MODEL_ORDER_TEXT || env.MODEL_ORDER || "");
  const moVis  = String(env.MODEL_ORDER_VISION || "");

  const lines = [
    "Admin panel (quick diagnostics):",
    `MODEL_ORDER: ${order}`,
    `TEXT: ${moText}`,
    `VISION: ${moVis}`,
    "",
    `GEMINI key: ${env.GEMINI_API_KEY ? "✅" : "❌"}`,
    `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${(env.CF_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) ? "✅" : "❌"}`,
    `OpenRouter key: ${env.OPENROUTER_API_KEY ? "✅" : "❌"}`,
    `FreeLLM (BASE_URL + KEY): ${(env.FREE_LLM_BASE_URL && (env.OPENROUTER_API_KEY || env.FREE_LLM_API_KEY)) ? "✅" : "❌"}`,
  ].join("\n");

  await tgCall(env, "sendMessage", {
    chat_id: chatId,
    text: "🧰 " + lines,
  });
}

async function handleText(env, upd) {
  const chatId = chatIdFromUpdate(upd);
  const text = upd.message?.text || "";
  const lang = tgLangFromUpdate(upd);

  if (/^\/start\b/.test(text)) {
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: `Привіт, ${upd.message?.from?.first_name || "друже"}! Як я можу допомогти?`,
    });
    return ok();
  }

  if (/^\/admin\b/i.test(text) || /^admin$/i.test(text)) {
    await handleAdmin(env, chatId);
    return ok();
  }

  // if user asks about previous photo: try recall
  if (/^(що|шо|what).*(фото|photo)/i.test(text)) {
    const mem = await loadPhotoMem(env, chatId);
    if (mem.length) {
      const last = mem[0];
      await tgCall(env, "sendMessage", {
        chat_id: chatId,
        text: `🖼️ Попереднє фото (збережено):\n${last.desc}`,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      });
      return ok();
    }
  }

  // default: simple echo + hint
  await tgCall(env, "sendMessage", {
    chat_id: chatId,
    text: "Напишіть повідомлення або надішліть фото — опишу його і запам’ятаю в контексті.",
  });
  return ok();
}
// src/routes/webhook.js  (part 4/6)

async function handlePhoto(env, upd) {
  const msg = upd.message;
  const chatId = msg.chat.id;
  const lang = tgLangFromUpdate(upd);

  // basic energy gate
  const e = await getEnergy(env, chatId);
  const cost = Number(env.ENERGY_COST_IMAGE || 5);
  if (e.val < cost) {
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "⚡ Низький рівень енергії. Спробуйте трохи пізніше.",
    });
    return ok();
  }

  const best = extractPhotoBest(msg);
  if (!best) {
    await tgCall(env, "sendMessage", { chat_id: chatId, text: "Не бачу фото у повідомленні." });
    return ok();
  }

  // download → base64
  let fileUrl, base64;
  try {
    fileUrl = await getFileUrl(env, best.file_id);
    base64 = await fetchAsBase64(fileUrl);
  } catch (e) {
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "Не вдалось завантажити фото. Спробуйте ще раз.",
    });
    return ok();
  }

  // describe via vision flow (it will handle JSON/plain + icon links + internal landmark fallback)
  let out = "";
  try {
    const { text } = await describeImage(env, {
      chatId,
      tgLang: lang,
      imageBase64: base64,
      question: msg.caption || "",
      modelOrder: env.MODEL_ORDER_VISION || env.MODEL_ORDER,
    });
    out = sanitizeAnswer(withMapIcon(text));
  } catch (e) {
    // final text fallback (modelRouter.askText)
    const hint = lang.startsWith("en")
      ? "Image analysis is temporarily unavailable. Please resend the photo."
      : "Аналіз зображення тимчасово недоступний. Будь ласка, надішліть фото ще раз.";
    out = hint;
  }

  // store into photo memory (for later turns)
  await savePhotoMem(env, chatId, {
    file_id: best.file_id,
    file_unique_id: best.file_unique_id,
    desc: out,
  });

  await spendEnergy(env, e, cost);

  await tgCall(env, "sendMessage", {
    chat_id: chatId,
    text: "🖼️ " + out,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });

  return ok();
}
// src/routes/webhook.js  (part 5/6)

// ─────────────────────────────────────────────────────────────────────────────
// Router

export async function handleTelegramWebhook(request, env) {
  // security (optional secret header)
  const tgSecret = env.TELEGRAM_SECRET_TOKEN || env.TG_WEBHOOK_SECRET || env.WEBHOOK_SECRET;
  if (tgSecret) {
    const hdr = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || request.headers.get("X-Telegram-Bot-Secret-Token");
    if (hdr && hdr !== tgSecret) return bad(403, "bad secret");
  }

  const upd = await request.json().catch(() => null);
  if (!upd) return bad(400, "no update");

  try {
    if (upd.message?.photo) {
      return await handlePhoto(env, upd);
    }
    if (typeof upd.message?.text === "string") {
      return await handleText(env, upd);
    }
    // ignore everything else
    return ok({ ignored: true });
  } catch (e) {
    // last resort log
    await env.STATE_KV.put(`err:${Date.now()}`, String(e?.stack || e));
    return ok({ error: true });
  }
}

// Cloudflare Worker entry
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/webhook") {
      if (request.method !== "POST") return bad(405, "method not allowed");
      return handleTelegramWebhook(request, env);
    }
    // simple health
    if (url.pathname === "/health") return ok({ status: "ok", ts: Date.now() });
    return new Response("Senti Worker", { status: 200 });
  }
};