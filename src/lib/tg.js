// src/lib/tg.js
import { abs } from "../utils/url.js";

export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_LEARN = "Learn"; // показуємо лише адмінам
export const BTN_ADMIN = "Admin";

// Мінімалістична клавіатура для всіх; розширена — лише для адміна
export const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) {
    // друга лінійка для адміну: Admin + Learn
    rows.push([{ text: BTN_ADMIN }, { text: BTN_LEARN }]);
  }
  return { keyboard: rows, resize_keyboard: true };
};

export const ADMIN = (env, userId) =>
  String(userId) === String(env.TELEGRAM_ADMIN_ID);

// Прямі лінки на енергію та чекліст (з секретом)
export function energyLinks(env, userId) {
  const s =
    env.WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    env.TG_WEBHOOK_SECRET ||
    "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(
    String(userId || "")
  )}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

// Кнопка “Поділитися локацією” (для сценаріїв погоди)
export const askLocationKeyboard = () => ({
  keyboard: [[{ request_location: true, text: "📍 Поділитися локацією" }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

// Надсилання простого тексту
export async function sendPlain(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    // посилання без прев’ю
    disable_web_page_preview: true,
  };
  if (extra.parse_mode) body.parse_mode = extra.parse_mode;
  if (extra.reply_markup) body.reply_markup = extra.reply_markup;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// Парсер команди /ai
export function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

/* ── Webhook helpers (використовуються у src/index.js) ──────────────────── */
async function tgGet(path, token) {
  return fetch(`https://api.telegram.org/bot${token}/${path}`, {
    method: "GET",
  });
}
async function tgPost(path, token, body) {
  return fetch(`https://api.telegram.org/bot${token}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

async function getWebhook(token) {
  return tgGet("getWebhookInfo", token);
}
async function setWebhook(token, url, secretToken = "") {
  const body = { url };
  if (secretToken) body.secret_token = secretToken;
  // дозволимо приймати фото/документи тощо
  body.allowed_updates = [
    "message",
    "edited_message",
    "channel_post",
    "callback_query"
  ];
  return tgPost("setWebhook", token, body);
}
async function deleteWebhook(token) {
  return tgPost("deleteWebhook", token, { drop_pending_updates: false });
}

export const TG = {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_LEARN,
  BTN_ADMIN,
  mainKeyboard,
  ADMIN,
  energyLinks,
  askLocationKeyboard,
  sendPlain,
  parseAiCommand,
  getWebhook,
  setWebhook,
  deleteWebhook,
};