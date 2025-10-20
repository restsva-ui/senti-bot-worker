// src/lib/tg.js
import { abs } from "../utils/url.js";

// Кнопки
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_LEARN = "Learn";
export const BTN_ADMIN = "Admin";

// Головна клавіатура: Drive | Senti | Learn | (Admin)
export const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }, { text: BTN_LEARN }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

// Прості ACL для адміна
export const ADMIN = (env, userId) => {
  const allow = (env.ADMIN_IDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return allow.includes(String(userId));
};

const API = (token) => `https://api.telegram.org/bot${token}`;

// Базова відправка
export async function sendPlain(env, chatId, text, extra = {}) {
  if (!env?.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is missing");
  const url = `${API(env.TELEGRAM_BOT_TOKEN)}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...extra,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`sendMessage failed: ${res.status} ${err}`);
  }
  return res.json();
}
export async function sendMD(env, chatId, text, extra = {}) {
  return sendPlain(env, chatId, text, { ...extra, parse_mode: "Markdown" });
}

export async function sendHTML(env, chatId, html, extra = {}) {
  return sendPlain(env, chatId, html, { ...extra, parse_mode: "HTML" });
}

// Мінімалістична стрілка ↗︎ як Markdown-лінк
export function arrowLink(url) {
  return `[↗︎](${url})`;
}
export async function sendWithArrow(env, chatId, text, url, extra = {}) {
  const msg = `${text}\n${arrowLink(url)}`;
  return sendMD(env, chatId, msg, extra);
}

// Допоміжні посилання (наприклад, енергопанель)
export function energyLinks(env, userId) {
  return {
    energyHtml: abs(env, `/admin/energy/html?s=${encodeURIComponent(env.WEBHOOK_SECRET)}&u=${encodeURIComponent(userId)}`),
  };
}

// Простий TG об’єкт для місцями сумісності
export const TG = {
  async send(env, chatId, text, extra) {
    return sendPlain(env, chatId, text, extra);
  },
};
