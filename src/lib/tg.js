// src/lib/tg.js
import { abs } from "../utils/url.js";

/* ───────────────────── КНОПКИ ───────────────────── */
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_LEARN = "Learn";   // показуємо тільки адмінам
export const BTN_ADMIN = "Admin";

/* ───────────────── ГОЛОВНА КЛАВІАТУРА ───────────── */
export const mainKeyboard = (isAdmin = false) => {
  const row = [{ text: BTN_DRIVE }, { text: BTN_SENTI }];
  if (isAdmin) row.push({ text: BTN_LEARN });
  const rows = [row];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

/* ──────────────── КНОПКА ЗАПИТУ ЛОКАЦІЇ ─────────── */
export const askLocationKeyboard = () => ({
  keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

/* ───────────────────── АДМІН-ПЕРЕВІРКА ──────────── */
export const ADMIN = (env, userId) =>
  String(userId) === String(env.TELEGRAM_ADMIN_ID);

/* ──────────────── КОРИСНІ ЛІНКИ ДЛЯ UI ──────────── */
export function energyLinks(env, userId) {
  const s =
    env.WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    env.TG_WEBHOOK_SECRET ||
    "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy:    abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
    learn:     abs(env, `/admin/learn/html?${qs}`),
  };
}

/* ───────────────────── ВІДПРАВКА ТЕКСТУ ─────────── */
export async function sendPlain(env, chatId, text, extra = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (extra.parse_mode)  body.parse_mode  = extra.parse_mode;
  if (extra.reply_markup) body.reply_markup = extra.reply_markup;

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/* ──────────────── ДІЇ ЧАТУ (typing/uploading) ───── */
export async function sendChatAction(env, chatId, action = "typing") {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendChatAction`;
  const body = { chat_id: chatId, action };
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {}
}

/** Обгортач: увімкнути "друкує…" на час довгої операції */
export async function withTyping(env, chatId, fn, { pingMs = 4000 } = {}) {
  let alive = true;
  // миттєвий ping
  sendChatAction(env, chatId, "typing").catch(()=>{});
  // періодичні пінги, доки триває операція
  const timer = setInterval(() => {
    if (!alive) return clearInterval(timer);
    sendChatAction(env, chatId, "typing").catch(()=>{});
  }, Math.max(2000, pingMs));
  try {
    return await fn();
  } finally {
    alive = false;
    clearInterval(timer);
  }
}

/** Обгортач: індикатор “йде завантаження…” */
export async function withUploading(env, chatId, fn, { action = "upload_document", pingMs = 4000 } = {}) {
  let alive = true;
  sendChatAction(env, chatId, action).catch(()=>{});
  const timer = setInterval(() => {
    if (!alive) return clearInterval(timer);
    sendChatAction(env, chatId, action).catch(()=>{});
  }, Math.max(2000, pingMs));
  try {
    return await fn();
  } finally {
    alive = false;
    clearInterval(timer);
  }
}

/* ───────────── Спінер через редагування повідомлення ────────────
   (опційно; дає UX на кшталт GPT — "Думаю…" з крапками)
*/
export async function startSpinner(env, chatId, base = "Думаю над відповіддю") {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;

  async function send(text) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text })
      });
      const j = await r.json().catch(()=>null);
      return j?.result?.message_id || null;
    } catch { return null; }
  }

  async function edit(message_id, text) {
    if (!message_id) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, message_id, text })
      });
    } catch {}
  }

  const messageId = await send(base + "…");
  if (!messageId) return { stop: async () => {} };

  let i = 0, alive = true;
  const dots = ["", ".", "..", "..."];
  const timer = setInterval(() => {
    if (!alive) return clearInterval(timer);
    i = (i + 1) % dots.length;
    edit(messageId, base + dots[i]);
  }, 1200);

  return {
    stop: async (finalText) => {
      alive = false; clearInterval(timer);
      if (finalText) await edit(messageId, finalText);
      else await edit(messageId, "Готово");
    }
  };
}

/* ───────────────────── Розбір /ai ────────────────── */
export function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

/* ─────────────────── Експорт one-stop TG ─────────── */
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
  // нові
  sendChatAction,
  withTyping,
  withUploading,
  startSpinner,
};