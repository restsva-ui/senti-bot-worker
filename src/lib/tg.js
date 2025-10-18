// src/lib/tg.js
import { abs } from "../utils/url.js";

export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_ADMIN = "Admin";

export const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

export const ADMIN = (env, userId) =>
  String(userId) === String(env.TELEGRAM_ADMIN_ID);

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
  };
}

export async function sendPlain(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    // попередній перегляд вимкнено (посилання стрілкою без прев’ю)
    disable_web_page_preview: true,
  };
  if (extra.parse_mode) body.parse_mode = extra.parse_mode; // <— ВАЖЛИВО
  if (extra.reply_markup) body.reply_markup = extra.reply_markup;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
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
  BTN_ADMIN,
  mainKeyboard,
  ADMIN,
  energyLinks,
  sendPlain,
  parseAiCommand,
};