// src/lib/tg.js
import { abs } from "../utils/url.js";

export const BTN_DRIVE = "Google Drive";
export const BTN_SENTI = "Senti";
export const BTN_CODEX = "Codex";
export const BTN_LEARN = "Learn";
export const BTN_ADMIN = "Admin";
export const BTN_VOICE = "🎙 Voice";

export const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }, { text: BTN_VOICE }]];
  if (isAdmin) {
    rows[0].push({ text: BTN_CODEX });
    rows.push([{ text: BTN_ADMIN }]);
  }
  return { keyboard: rows, resize_keyboard: true };
};

export const ADMIN = (env, userId, username) => {
  const id = String(userId || "");
  const ids = [env.TELEGRAM_ADMIN_ID, env.TELEGRAM_OWNER_ID, env.ADMIN_USER_ID, env.ADMIN_ID, env.ADMINS]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (ids.includes(id)) return true;

  const normalizedUsername = String(username || "").replace(/^@/, "").toLowerCase();
  const usernames = [env.ADMIN_USERNAME, env.ADMIN_USERNAMES]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((value) => value.replace(/^@/, "").trim().toLowerCase())
    .filter(Boolean);
  return Boolean(normalizedUsername && usernames.includes(normalizedUsername));
};

function normalizeEnv(tokenOrEnv) {
  if (typeof tokenOrEnv === "string") return { BOT_TOKEN: tokenOrEnv };
  return tokenOrEnv || {};
}

function tokenFromEnv(tokenOrEnv) {
  const env = normalizeEnv(tokenOrEnv);
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN or BOT_TOKEN missing");
  return token;
}

function apiUrl(tokenOrEnv, method) {
  return `https://api.telegram.org/bot${tokenFromEnv(tokenOrEnv)}/${method}`;
}

async function telegramRequest(tokenOrEnv, method, payload, init = {}) {
  const response = await fetch(apiUrl(tokenOrEnv, method), {
    method: init.method || "POST",
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { ok: false, description: text || "Invalid Telegram response" };
  }

  if (!response.ok || data?.ok === false) {
    const error = new Error(`${method}: ${data?.description || `Telegram HTTP ${response.status}`}`);
    error.status = response.status;
    error.response = data;
    throw error;
  }
  return data;
}

export async function sendMessage(chatId, text, extra = {}, env) {
  if (chatId === undefined || chatId === null) throw new Error("chatId missing");
  const normalizedText = String(text ?? "").trim();
  if (!normalizedText) throw new Error("Telegram message text is empty");
  return telegramRequest(env, "sendMessage", {
    chat_id: chatId,
    text: normalizedText.slice(0, 4096),
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function getFile(env, fileId) {
  if (!fileId) throw new Error("fileId missing");
  const response = await fetch(`${apiUrl(env, "getFile")}?file_id=${encodeURIComponent(fileId)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.description || "Telegram getFile failed");
  return data.result;
}

export async function getWebhook(tokenOrEnv) {
  return telegramRequest(tokenOrEnv, "getWebhookInfo", {});
}

export async function setWebhook(tokenOrEnv, targetUrl, secretToken) {
  const env = normalizeEnv(tokenOrEnv);
  const url = targetUrl || abs(env, "/webhook");
  const payload = { url, drop_pending_updates: false };
  if (secretToken) payload.secret_token = secretToken;
  return telegramRequest(tokenOrEnv, "setWebhook", payload);
}

export async function deleteWebhook(tokenOrEnv, dropPendingUpdates = false) {
  return telegramRequest(tokenOrEnv, "deleteWebhook", {
    drop_pending_updates: Boolean(dropPendingUpdates),
  });
}

export const TG = {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_CODEX,
  BTN_LEARN,
  BTN_ADMIN,
  BTN_VOICE,
  mainKeyboard,
  ADMIN,
  sendMessage,
  getFile,
  getWebhook,
  setWebhook,
  deleteWebhook,
};
