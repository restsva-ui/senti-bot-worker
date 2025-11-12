// src/lib/tg.js
import { abs } from "../utils/url.js";

/* ───────────────────── КНОПКИ (reply) ───────────────────── */
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_CODEX = "Codex";
export const BTN_LEARN = "Learn";
export const BTN_ADMIN = "Admin";

/* ──────────────── CALLBACK DATA (inline) ──────────────── */
// Єдине місце істини для callback_data — щоб не роз’їхалось між файлами.
export const CB = {
  CODEX_PROJECT_NEW: "codex:project:new",
  CODEX_PROJECT_LIST: "codex:project:list",
  CODEX_PROJECT_STATUS: "codex:project:status",
  CODEX_IDEA_LOCK: "codex:project:idea:lock",
  CODEX_IDEA_UNLOCK: "codex:project:idea:unlock",
};

/* ───────────────── ГОЛОВНА КЛАВІАТУРА (reply) ───────────── */
export const mainKeyboard = (isAdmin = false) => {
  const rows = [];
  const baseRow = [{ text: BTN_DRIVE }, { text: BTN_SENTI }];
  rows.push(baseRow);
  if (isAdmin) {
    rows[0].push({ text: BTN_CODEX });
    rows.push([{ text: BTN_ADMIN }]);
  }
  return { keyboard: rows, resize_keyboard: true };
};

/* ────────────────── ІНЛАЙН-МЕНЮ CODEX ────────────────── */
/**
 * Меню управління Codex-проєктами.
 * Використовується у вебхуку при ввімкненні Codex або за командою.
 */
export const codexProjectMenu = () => ({
  inline_keyboard: [
    [
      { text: "🆕 New Project", callback_data: CB.CODEX_PROJECT_NEW },
      { text: "📂 Use / List", callback_data: CB.CODEX_PROJECT_LIST },
      { text: "📊 Status", callback_data: CB.CODEX_PROJECT_STATUS },
    ],
    [
      { text: "🔒 Lock Idea", callback_data: CB.CODEX_IDEA_LOCK },
      { text: "🔓 Unlock Idea", callback_data: CB.CODEX_IDEA_UNLOCK },
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
  BTN_DRIVE,
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