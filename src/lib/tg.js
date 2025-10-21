// src/lib/tg.js
import { abs } from "../utils/url.js";

// Кнопки
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_LEARN = "Learn";   // показуємо тільки адмінам
export const BTN_ADMIN = "Admin";

// Головна клавіатура: Drive | Senti | (Learn тільки для адміна) | (Admin)
export const mainKeyboard = (isAdmin = false) => {
  const row = [{ text: BTN_DRIVE }, { text: BTN_SENTI }];
  if (isAdmin) row.push({ text: BTN_LEARN });
  const rows = [row];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

// Кнопка запиту локації (для погоди)
export const askLocationKeyboard = () => ({
  keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

export const ADMIN = (env, userId) =>
  String(userId) === String(env.TELEGRAM_ADMIN_ID);

// Посилання (енергія / чекліст / learn)
export function energyLinks(env, userId) {
  const s =
    env.WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    env.TG_WEBHOOK_SECRET ||
    "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
    learn: abs(env, `/admin/learn/html?${qs}`),
  };
}

/* ===================== Telegram API helpers ===================== */

function botToken(env) {
  return env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
}

async function tgCall(env, method, payload) {
  const token = botToken(env);
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data?.ok) throw new Error(data?.description || `HTTP ${r.status}`);
    return data.result;
  } catch {
    // тихо ігноруємо у проді
    return null;
  }
}

/** Показати індикатор активності: typing / upload_photo / upload_document / upload_video */
export async function sendChatAction(env, chatId, action = "typing") {
  return tgCall(env, "sendChatAction", { chat_id: chatId, action });
}

/**
 * Запускає періодичний індикатор під час виконання async-функції fn().
 * За замовчуванням — typing кожні ~4с (Telegram сам гасить через ~5с).
 * Використання:
 *   await withAction(env, chatId, () => довгаОперація(), "typing");
 */
export async function withAction(env, chatId, fn, action = "typing", pingMs = 4000) {
  let timer = null;
  try {
    await sendChatAction(env, chatId, action);
    timer = setInterval(() => sendChatAction(env, chatId, action), pingMs);
    const res = await fn();
    return res;
  } finally {
    if (timer) clearInterval(timer);
  }
}

// Зручні шорткати
export const withTyping = (env, chatId, fn) => withAction(env, chatId, fn, "typing");
export const withUploading = (env, chatId, fn) => withAction(env, chatId, fn, "upload_document");

// Відправка повідомлення
export async function sendPlain(env, chatId, text, extra = {}) {
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (extra.parse_mode) body.parse_mode = extra.parse_mode;
  if (extra.reply_markup) body.reply_markup = extra.reply_markup;
  await tgCall(env, "sendMessage", body);
}

export function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

export const TG = {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_LEARN,
  BTN_ADMIN,
  mainKeyboard,
  ADMIN,
  energyLinks,
  sendPlain,
  parseAiCommand,
  askLocationKeyboard,

  // нове:
  sendChatAction,
  withAction,
  withTyping,
  withUploading,
};
