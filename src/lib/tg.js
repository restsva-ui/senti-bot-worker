// src/lib/tg.js
import { abs } from "../utils/url.js";

// Кнопки
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_LEARN = "Learn";
export const BTN_ADMIN = "Admin";

// Головна клавіатура
export const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }, { text: BTN_LEARN }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

// Допоміжна клавіатура — запит локації
export const askLocationKeyboard = () => ({
  keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

// Перевірка адміна
export const ADMIN = (env, userId) =>
  String(userId) === String(env.TELEGRAM_ADMIN_ID);

// Прямі лінки в адмін-панель енергії/чекліста
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

// Надсилання простого тексту
export async function sendPlain(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
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

// Парсер /ai
export function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

// Webhook helpers (щоб не дублювати в index.js)
async function tgApi(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  return r;
}

export const TG = {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_LEARN,
  BTN_ADMIN,
  mainKeyboard,
  askLocationKeyboard,
  ADMIN,
  energyLinks,
  sendPlain,
  parseAiCommand,

  async getWebhook(token) {
    return tgApi(token, "getWebhookInfo", {});
  },
  async setWebhook(token, url, secret) {
    return tgApi(token, "setWebhook", {
      url,
      secret_token: secret || undefined,
      allowed_updates: [
        "message",
        "edited_message",
        "callback_query",
        "channel_post",
        "edited_channel_post",
      ],
      drop_pending_updates: false,
    });
  },
  async deleteWebhook(token) {
    return tgApi(token, "deleteWebhook", { drop_pending_updates: false });
  },
};