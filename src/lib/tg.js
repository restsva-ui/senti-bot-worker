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

  // аліаси для зворотної сумісності
  CODEX_PROJECT_NEW: "codex:new",
  CODEX_PROJECT_LIST: "codex:list",
  CODEX_PROJECT_STATUS: "codex:status",
  CODEX_IDEA_LOCK: "codex:idea:lock:deprecated",
  CODEX_IDEA_UNLOCK: "codex:idea:unlock:deprecated",
};

/* ───────────────── ГОЛОВНА КЛАВІАТУРА (reply) ───────────── */
/**
 * isAdmin=true  → показуємо Senti + Codex + Admin
 * isAdmin=false → показуємо Senti + Codex
 */
export const mainKeyboard = (isAdmin = false) => {
  const rows = [];
  // Основне меню для всіх користувачів
  rows.push([{ text: BTN_SENTI }, { text: BTN_CODEX }]);
  // Адмінська кнопка
  if (isAdmin) {
    rows.push([{ text: BTN_ADMIN }]);
  }
  return { keyboard: rows, resize_keyboard: true };
};

/* ────────────────── ІНЛАЙН-МЕНЮ CODEX ────────────────── */
/**
 * Меню керування Codex-проєктами.
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
  };
};

/* ───────────────── TG SEND HELPERS ─────────────── */
export async function sendPlain(env, chatId, text, extra = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token || !chatId || !text) return;
  const body = { chat_id: chatId, text, ...extra };
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/** Клавіатура-запит локації (для погоди) */
export const askLocationKeyboard = () => ({
  keyboard: [[{ text: "📍 Надіслати локацію", request_location: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

/** Базова обгортка для sendChatAction */
export async function sendChatAction(env, chatId, action) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token || !chatId || !action) return;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

export const withTyping = (env, chatId, fn) =>
  withChatAction(env, chatId, "typing", fn);
export const withUploading = (env, chatId, fn) =>
  withChatAction(env, chatId, "upload_document", fn);

/** Спіннер для довгих операцій */
async function withChatAction(env, chatId, action, fn) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token || !chatId || !action) return fn();

  let alive = true;
  const timer = setInterval(() => {
    if (!alive) return;
    fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    }).catch(() => {});
  }, 4500);

  try {
    return await fn();
  } finally {
    alive = false;
    clearInterval(timer);
  }
}

/** Спіннер із можливістю ручної зупинки */
export async function startSpinner(env, chatId, action = "typing") {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token || !chatId || !action)
    return { stop: async () => {} };

  let alive = true;
  const timer = setInterval(() => {
    if (!alive) return;
    fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
    }).catch(() => {});
  }, 1400);

  return { stop: async () => { alive = false; clearInterval(timer); } };
}

/* ───────────────── ЕКСПОРТ ─────────────── */
export const TG = {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_CODEX,
  BTN_LEARN,
  BTN_ADMIN,
  mainKeyboard,
  CB,
  codexProjectMenu,
  ADMIN,
  energyLinks,
  sendPlain,
  askLocationKeyboard,
  sendChatAction,
  withTyping,
  withUploading,
  startSpinner,
};

