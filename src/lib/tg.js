// src/lib/tg.js
import { abs } from "../utils/url.js";

/* ───────────────────── КНОПКИ (reply) ───────────────────── */
export const BTN_DRIVE = "Google Drive"; // лишаємо константу для сумісності (в меню не показуємо звичним юзерам)
export const BTN_SENTI = "Senti";
export const BTN_CODEX = "Codex";
export const BTN_LEARN = "Learn";
export const BTN_ADMIN = "Admin";

/* ──────────────── CALLBACK DATA (inline) ──────────────── */
/**
 * Єдине місце істини для callback_data.
 * Нові ключі: CB.NEW / CB.USE / CB.LIST / CB.STATUS
 * Для сумісності додані аліаси під старі назви (CODEX_PROJECT_*).
 */
export const CB = {
  // новий формат
  NEW: "codex:new",
  USE: "codex:use",
  LIST: "codex:list",
  STATUS: "codex:status",

  // аліаси для зворотної сумісності (не видаляти, поки все не мігрує)
  CODEX_PROJECT_NEW: "codex:new",
  CODEX_PROJECT_LIST: "codex:list",
  CODEX_PROJECT_STATUS: "codex:status",
  // (lock/unlock були прибрані з UX; залишаємо аліаси на випадок старих викликів)
  CODEX_IDEA_LOCK: "codex:idea:lock:deprecated",
  CODEX_IDEA_UNLOCK: "codex:idea:unlock:deprecated",
};

/* ───────────────── ГОЛОВНА КЛАВІАТУРА (reply) ───────────── */
/**
 * isAdmin=true  → показуємо Senti + Codex + Admin
 * isAdmin=false → прибираємо клавіатуру повністю
 */
export const mainKeyboard = (isAdmin = false) => {
  if (!isAdmin) {
    return { remove_keyboard: true };
  }
  const rows = [];
  rows.push([{ text: BTN_SENTI }, { text: BTN_CODEX }]);
  rows.push([{ text: BTN_ADMIN }]);
  return { keyboard: rows, resize_keyboard: true };
};

/* ────────────────── ІНЛАЙН-МЕНЮ CODEX ────────────────── */
/**
 * Меню керування Codex-проєктами (без lock/unlock).
 * Використовується у вебхуку при ввімкненні Codex.
 */
export const codexProjectMenu = () => ({
  inline_keyboard: [
    [
      { text: "➕ Створити проєкт", callback_data: CB.NEW },
      { text: "📂 Обрати проєкт", callback_data: CB.USE },
    ],
    [
      { text: "🗂 Список", callback_data: CB.LIST },
      { text: "📊 Статус", callback_data: CB.STATUS },
    ],
  ],
});

/* ───────────────── АДМІН ─────────────── */
export const ADMIN = (env, userId, username) => {
  const idStr = String(userId || "");
  const idCandidates = [
    env.TELEGRAM_ADMIN_ID,
    env.TELEGRAM_OWNER_ID,
    env.ADMIN_USER_ID,
    env.ADMIN_ID,
    env.ADMINS,
  ]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const idMatch = idCandidates.some((v) => v === idStr);

  const uname = String(username || "").replace("@", "").toLowerCase();
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

/* ───────────────── РОЗБИВКА ПОВІДОМЛЕНЬ ─────────── */
function splitForTelegram(text, chunk = 3900) {
  const s = String(text ?? "");
  if (s.length <= chunk) return [s];
  const out = [];
  for (let i = 0; i < s.length; i += chunk) out.push(s.slice(i, i + chunk));
  return out;
}

/* ───────────────── ВІДПРАВКА ТЕКСТУ ─────────────── */
export async function sendPlain(env, chatId, text, extra = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const chunks = splitForTelegram(text);
  for (const part of chunks) {
    const body = {
      chat_id: chatId,
      text: part,
      disable_web_page_preview: true,
    };
    if (extra.parse_mode) body.parse_mode = extra.parse_mode;
    if (extra.reply_markup) body.reply_markup = extra.reply_markup;
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

/* ───────────────── ЗАПИТ ЛОКАЦІЇ ─────────────── */
export const askLocationKeyboard = () => ({
  keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

/* ───────────────── ДІЇ ЧАТУ ─────────────── */
export async function sendChatAction(env, chatId, action = "typing") {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
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
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  let alive = true;
  let dot = 0;

  const msg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: base }),
  })
    .then((r) => r.json())
    .catch(() => null);

  const timer = setInterval(async () => {
    if (!alive || !msg?.result?.message_id) return;
    dot = (dot + 1) % 4;
    const text = base + ".".repeat(dot);
    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: msg.result.message_id,
        text,
      }),
    }).catch(() => {});
  }, 1400);

  return { stop: async () => { alive = false; clearInterval(timer); } };
}

/* ───────────────── ЕКСПОРТ ─────────────── */
export const TG = {
  // reply
  BTN_DRIVE, // лишили для сумісності (в меню не використовується)
  BTN_SENTI,
  BTN_CODEX,
  BTN_LEARN,
  BTN_ADMIN,
  mainKeyboard,

  // inline
  CB,
  codexProjectMenu,

  // utils
  ADMIN,
  energyLinks,
  sendPlain,
  askLocationKeyboard,
  sendChatAction,
  withTyping,
  withUploading,
  startSpinner,
};