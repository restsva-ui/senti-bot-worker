// src/lib/tg.js
import { abs } from "../utils/url.js";

/* ───────────────────── КНОПКИ ───────────────────── */
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_CODEX = "Codex";
export const BTN_LEARN = "Learn";
export const BTN_ADMIN = "Admin";

/* ───────────────── ГОЛОВНА КЛАВІАТУРА ───────────── */
/**
 * isAdmin=true → показуємо Codex + Admin
 * isAdmin=false → тільки публічні кнопки
 */
export const mainKeyboard = (isAdmin = false) => {
  const rows = [];

  // базовий рядок для всіх
  const baseRow = [{ text: BTN_DRIVE }, { text: BTN_SENTI }];
  rows.push(baseRow);

  // Codex тільки адмінам
  if (isAdmin) {
    rows[0].push({ text: BTN_CODEX });
    rows.push([{ text: BTN_ADMIN }]);
  }

  return { keyboard: rows, resize_keyboard: true };
};

/* ───────────────── АДМІН ─────────────── */
/**
 * Визначаємо адміна:
 * - по ID: TELEGRAM_ADMIN_ID, TELEGRAM_OWNER_ID, ADMIN_USER_ID, ADMIN_ID, ADMINS="id1,id2"
 * - по username: ADMIN_USERNAME, ADMIN_USERNAMES="@name1,@name2"
 * webhook має викликати ADMIN(env, id, username)
 */
export const ADMIN = (env, userId, username) => {
  const idStr = String(userId || "");

  const idCandidates = [
    env.TELEGRAM_ADMIN_ID,
    env.TELEGRAM_OWNER_ID,
    env.ADMIN_USER_ID,
    env.ADMIN_ID,
    env.ADMINS, // може бути "123,456"
  ]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const idMatch = idCandidates.some((v) => v === idStr);

  const uname = String(username || "")
    .replace("@", "")
    .toLowerCase();

  const unameCandidates = [env.ADMIN_USERNAME, env.ADMIN_USERNAMES]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((s) => s.replace("@", "").trim().toLowerCase())
    .filter(Boolean);

  const unameMatch = uname && unameCandidates.includes(uname);

  return idMatch || unameMatch;
};

/* ───────────────── ПОСИЛАННЯ ЛІНКІВ ─────────────── */
export const energyLinks = (env, userId) => {
  const base = abs(env, "/admin/energy");
  return {
    energy: `${base}?u=${encodeURIComponent(userId)}`,
    learn: abs(env, "/admin/learn"),
    checklist: abs(env, "/admin/checklist"),
  };
};

/* ───────────────── ВНУТРІШНІ УТИЛІТИ ─────────────── */
function pickToken(env) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error("Telegram token missing (set TELEGRAM_BOT_TOKEN or BOT_TOKEN)");
  return token;
}

function apiBase(env) {
  return `https://api.telegram.org/bot${pickToken(env)}`;
}

async function safeFetchJson(url, init) {
  const r = await fetch(url, init);
  const txt = await r.text();
  let data = null;
  try {
    data = JSON.parse(txt);
  } catch {
    data = { ok: false, error: "non-json response", raw: txt };
  }
  if (!r.ok) {
    const msg = data?.description || data?.error || `HTTP ${r.status}`;
    const e = new Error(msg);
    e.status = r.status;
    e.data = data;
    throw e;
  }
  return data;
}

/* ───────────────── РОЗБИВКА ПОВІДОМЛЕНЬ ─────────── */
function splitForTelegram(text, chunk = 3900) {
  const s = String(text ?? "");
  if (s.length <= chunk) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += chunk) out.push(s.slice(i, i + chunk));
  return out;
}

/* ───────────────── ВІДПРАВКА ТЕКСТУ ─────────────── */
/**
 * sendMessage — основний метод (сумісний з webhook/index.js)
 * opts:
 *  - parse_mode
 *  - reply_markup
 *  - disable_web_page_preview
 *  - reply_to_message_id
 */
export async function sendMessage(chatId, text, opts = {}, env) {
  const base = apiBase(env);
  const chunks = splitForTelegram(text);

  let last = null;
  for (const part of chunks) {
    const body = {
      chat_id: chatId,
      text: part,
      disable_web_page_preview: opts.disable_web_page_preview ?? true,
    };
    if (opts.parse_mode) body.parse_mode = opts.parse_mode;
    if (opts.reply_markup) body.reply_markup = opts.reply_markup;
    if (opts.reply_to_message_id) body.reply_to_message_id = opts.reply_to_message_id;

    last = await safeFetchJson(`${base}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  return last;
}

/**
 * sendPlain — залишаю як у тебе (просто обгортка над sendMessage)
 */
export async function sendPlain(env, chatId, text, extra = {}) {
  return await sendMessage(chatId, text, extra, env);
}

/* ───────────────── CALLBACK QUERY ─────────────── */
/**
 * Безпечно підтверджує натискання кнопки
 */
export async function answerCallbackQuery(callbackQueryId, opts = {}, env) {
  const base = apiBase(env);
  const body = { callback_query_id: callbackQueryId };
  if (opts.text) body.text = opts.text;
  if (typeof opts.show_alert === "boolean") body.show_alert = opts.show_alert;

  return await safeFetchJson(`${base}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/* ───────────────── WEBHOOK HELPERS ─────────────── */
export async function getWebhook(tokenOrEnv) {
  // підтримка: TG.getWebhook(env.BOT_TOKEN) як у твоєму index.js
  const token =
    typeof tokenOrEnv === "string"
      ? tokenOrEnv
      : tokenOrEnv?.TELEGRAM_BOT_TOKEN || tokenOrEnv?.BOT_TOKEN;

  if (!token) throw new Error("getWebhook: token missing");
  const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  return r;
}

export async function setWebhook(tokenOrEnv, url, secretToken) {
  const token =
    typeof tokenOrEnv === "string"
      ? tokenOrEnv
      : tokenOrEnv?.TELEGRAM_BOT_TOKEN || tokenOrEnv?.BOT_TOKEN;

  if (!token) throw new Error("setWebhook: token missing");
  const body = { url };
  if (secretToken) body.secret_token = secretToken;

  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r;
}

export async function deleteWebhook(tokenOrEnv) {
  const token =
    typeof tokenOrEnv === "string"
      ? tokenOrEnv
      : tokenOrEnv?.TELEGRAM_BOT_TOKEN || tokenOrEnv?.BOT_TOKEN;

  if (!token) throw new Error("deleteWebhook: token missing");
  const r = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
  return r;
}

/* ───────────────── ЗАПИТ ЛОКАЦІЇ ─────────────── */
export const askLocationKeyboard = () => ({
  keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

/* ───────────────── ДІЇ ЧАТУ ─────────────── */
export async function sendChatAction(env, chatId, action = "typing") {
  const base = apiBase(env);
  await safeFetchJson(`${base}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

export async function withTyping(env, chatId, fn) {
  await sendChatAction(env, chatId, "typing");
  return await fn();
}
export async function withUploading(env, chatId, fn) {
  await sendChatAction(env, chatId, "upload_document");
  return await fn();
}

/* ───────────────── Спінер ─────────────── */
export async function startSpinner(env, chatId, base = "Думаю над відповіддю") {
  const api = apiBase(env);
  let alive = true;
  let dot = 0;

  const msg = await safeFetchJson(`${api}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: base }),
  }).catch(() => null);

  const timer = setInterval(async () => {
    if (!alive || !msg?.result?.message_id) return;
    dot = (dot + 1) % 4;
    const text = base + ".".repeat(dot);

    await fetch(`${api}/editMessageText`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: msg.result.message_id,
        text,
      }),
    }).catch(() => {});
  }, 1400);

  return {
    stop: async () => {
      alive = false;
      clearInterval(timer);
    },
  };
}

/* ───────────────── ЕКСПОРТ ─────────────── */
export const TG = {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_CODEX,
  BTN_LEARN,
  BTN_ADMIN,
  mainKeyboard,
  ADMIN,
  energyLinks,
  sendPlain,
  sendMessage,
  answerCallbackQuery,
  askLocationKeyboard,
  sendChatAction,
  withTyping,
  withUploading,
  startSpinner,
  getWebhook,
  setWebhook,
  deleteWebhook,
};