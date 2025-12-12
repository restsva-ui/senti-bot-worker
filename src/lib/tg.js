// src/lib/tg.js
import { abs } from "../utils/url.js";

/* ───────────────────── КНОПКИ ───────────────────── */
export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_CODEX = "Codex";
export const BTN_LEARN = "Learn";
export const BTN_ADMIN = "Admin";

/* ───────────────── ГОЛОВНА КЛАВІАТУРА ───────────── */
export const mainKeyboard = (isAdmin = false) => {
  const rows = [];
  rows.push([{ text: BTN_DRIVE }, { text: BTN_SENTI }]);

  if (isAdmin) {
    rows[0].push({ text: BTN_CODEX });
    rows.push([{ text: BTN_ADMIN }]);
  }

  return { keyboard: rows, resize_keyboard: true };
};

/* ───────────────── АДМІН ───────────────── */
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
    .map((s) => s.trim());

  if (idCandidates.includes(idStr)) return true;

  const uname = String(username || "").replace("@", "").toLowerCase();
  const unameCandidates = [
    env.ADMIN_USERNAME,
    env.ADMIN_USERNAMES,
  ]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((s) => s.replace("@", "").toLowerCase());

  return uname && unameCandidates.includes(uname);
};
/* ───────────────── TELEGRAM API ───────────────── */

function tgBase(env) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN missing");
  return `https://api.telegram.org/bot${token}`;
}

export async function sendMessage(chatId, text, extra = {}, env) {
  const url = tgBase(env) + "/sendMessage";
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...extra,
    }),
  });
}

export async function getFile(env, fileId) {
  const url = tgBase(env) + `/getFile?file_id=${encodeURIComponent(fileId)}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!data?.ok) {
    throw new Error("Telegram getFile failed");
  }
  return data.result;
}

/* ───────────────── ЕКСПОРТ ───────────────── */
export const TG = {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_CODEX,
  BTN_LEARN,
  BTN_ADMIN,
  mainKeyboard,
  ADMIN,
  sendMessage,
  getFile,
};