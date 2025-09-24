// Адаптер Telegram: тільки базові виклики API.
// ЗАЛИШАЄ сигнатури/імена, які вже імпортуються у router.js:
//
//   import { tgSendMessage, tgSendAction, tgGetFileUrl } from "./adapters/telegram.js";
//
// Потрібні ENV:
//   - TG_BOT_TOKEN  (обов'язково)

const TG_API_BASE = "https://api.telegram.org";

function tgApiUrl(env, method) {
  const token = env?.TG_BOT_TOKEN;
  if (!token) throw new Error("TG_BOT_TOKEN is not set");
  return `${TG_API_BASE}/bot${token}/${method}`;
}

async function tgFetchJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok || !data?.ok) {
    throw new Error(`TG API error: ${url.split("/").pop()} ${JSON.stringify(data ?? {status: res.status})}`);
  }
  return data.result;
}

/** Надіслати 'action' (typing, upload_photo, etc.) */
export async function tgSendAction(chatId, action = "typing", env) {
  const url = tgApiUrl(env, "sendChatAction");
  await tgFetchJson(url, { chat_id: chatId, action });
}

/** Надіслати текстове повідомлення */
export async function tgSendMessage(chatId, text, options = {}, env) {
  const url = tgApiUrl(env, "sendMessage");
  const payload = {
    chat_id: chatId,
    text: text ?? "",
    parse_mode: options.parse_mode ?? "Markdown",
    reply_to_message_id: options.reply_to_message_id,
    disable_web_page_preview: true,
  };
  return await tgFetchJson(url, payload);
}

/** Отримати прямий URL файлу за file_id */
export async function tgGetFileUrl(fileId, env) {
  if (!fileId) return null;
  const token = env?.TG_BOT_TOKEN;
  if (!token) throw new Error("TG_BOT_TOKEN is not set");

  // 1) getFile -> file_path
  const getFileUrl = tgApiUrl(env, "getFile");
  const res = await fetch(getFileUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id: fileId }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok || !data.result?.file_path) return null;

  // 2) сформувати прямий URL
  const path = data.result.file_path;
  return `${TG_API_BASE}/file/bot${token}/${path}`;
}