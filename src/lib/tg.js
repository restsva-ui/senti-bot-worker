// src/lib/tg.js
import { abs } from "../utils/url.js";

// Кнопки
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_LEARN = "Learn";   // є в константах, але в клавіатурі тільки для адміна
export const BTN_ADMIN = "Admin";

// Головна клавіатура:
// - для звичайних: [Drive, Senti]
// - для адміна:     [Drive, Senti, Learn] + окрема нижня [Admin]
export const mainKeyboard = (isAdmin = false) => {
  const firstRow = isAdmin
    ? [{ text: BTN_DRIVE }, { text: BTN_SENTI }, { text: BTN_LEARN }]
    : [{ text: BTN_DRIVE }, { text: BTN_SENTI }];
  const rows = [firstRow];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

// Клавіатура для запиту локації (використовується у погоді)
export const askLocationKeyboard = () => ({
  keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }], [{ text: BTN_SENTI }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

// Простий ACL для адміна
export const ADMIN = (env, userId) =>
  String(userId) === String(env.TELEGRAM_ADMIN_ID);

// Корисні посилання (енергія / чекліст / learn)
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

// Відправка простого тексту
export async function sendPlain(env, chatId, text, extra = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN; // підтримка обох назв
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true, // стрілка без прев’ю
  };
  if (extra.parse_mode) body.parse_mode = extra.parse_mode;
  if (extra.reply_markup) body.reply_markup = extra.reply_markup;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// Зручні варіанти форматів
export async function sendMD(env, chatId, text, extra = {}) {
  return sendPlain(env, chatId, text, { ...extra, parse_mode: "Markdown" });
}
export async function sendHTML(env, chatId, html, extra = {}) {
  return sendPlain(env, chatId, html, { ...extra, parse_mode: "HTML" });
}

// /ai командa з текстом після неї
export function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

// Експорт спільного об’єкта
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
  sendMD,
  sendHTML,
  parseAiCommand,
};
