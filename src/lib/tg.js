// src/lib/tg.js
import { abs } from "../utils/url.js";

// ── Кнопки ──────────────────────────────────────────────────────────────────
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_LEARN = "Learn";
export const BTN_ADMIN = "Admin";

// ── Головна клавіатура ──────────────────────────────────────────────────────
// Ряд 1: Drive | Senti | Learn
// Ряд 2: Admin (лише для адміна)
export const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }, { text: BTN_LEARN }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

// ── Клавіатура — запит локації ──────────────────────────────────────────────
export const askLocationKeyboard = () => ({
  keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

// ── Перевірка адміна ────────────────────────────────────────────────────────
export const ADMIN = (env, userId) =>
  String(userId) === String(env.TELEGRAM_ADMIN_ID);

// ── Прямі лінки в адмін-панель (енергія/чекліст/learn) ───────────────────────
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

// ── Відправники повідомлень ────────────────────────────────────────────────
/**
 * Базовий відправник: текст, без прев’ю лінків (бо використовуємо ↗︎).
 * Підтримує extra.parse_mode ("Markdown"/"HTML") та extra.reply_markup.
 */
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

/** Зручні шорткати */
export async function sendMarkdown(env, chatId, text, extra = {}) {
  return sendPlain(env, chatId, text, { ...extra, parse_mode: "Markdown" });
}
export async function sendHTML(env, chatId, html, extra = {}) {
  return sendPlain(env, chatId, html, { ...extra, parse_mode: "HTML" });
}

// ── Мінімалістична стрілка ↗︎ як Markdown-посилання ─────────────────────────
/** Повертає рядок виду: `[↗︎](https://...)` */
export function arrowLink(url) {
  return `[↗︎](${url})`;
}
/** Відправити текст + стрілку (Markdown), прев’ю вимкнене */
export async function sendWithArrow(env, chatId, text, url, extra = {}) {
  const msg = `${text}\n${arrowLink(url)}`;
  return sendMarkdown(env, chatId, msg, extra);
}

// ── Парсер /ai ──────────────────────────────────────────────────────────────
export function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

// ── Низькорівневий API для вебхука (щоб не дублювати в index.js) ────────────
async function tgApi(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  return r;
}

/** Зручно перевіряти/ставити/видаляти вебхук */
async function getWebhook(token) {
  return tgApi(token, "getWebhookInfo", {});
}
async function setWebhook(token, url, secret) {
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
}
async function deleteWebhook(token) {
  return tgApi(token, "deleteWebhook", { drop_pending_updates: false });
}

// ── Пакуємо зручний namespace ───────────────────────────────────────────────
export const TG = {
  // кнопки
  BTN_DRIVE,
  BTN_SENTI,
  BTN_LEARN,
  BTN_ADMIN,
  // клавіатури
  mainKeyboard,
  askLocationKeyboard,
  // доступ
  ADMIN,
  // лінки
  energyLinks,
  // відправники
  sendPlain,
  sendMarkdown,
  sendHTML,
  // стрілка
  arrowLink,
  sendWithArrow,
  // команди
  parseAiCommand,
  // вебхук-API
  getWebhook,
  setWebhook,
  deleteWebhook,
};
 
