// src/adapters/telegram.js

/**
 * Невеличкий SDK для Telegram Bot API
 * Використовуємо лише три методи: sendMessage, sendChatAction, getFile
 */

const tgApi = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

async function tgSendMessage(env, chatId, text, options = {}) {
  const token = env.TELEGRAM_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_TOKEN in env");

  const body = {
    chat_id: chatId,
    text,
    parse_mode: options.parse_mode || "Markdown",
    disable_web_page_preview: options.disable_web_page_preview ?? true,
    reply_to_message_id: options.reply_to_message_id || undefined,
  };

  const res = await fetch(tgApi(token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("TG API error: sendMessage", JSON.stringify(data));
  }
  return data;
}

async function tgSendChatAction(env, chatId, action = "typing") {
  const token = env.TELEGRAM_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_TOKEN in env");

  const res = await fetch(tgApi(token, "sendChatAction"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  });

  const data = await res.json();
  if (!data.ok) {
    console.error("TG API error: sendChatAction", JSON.stringify(data));
  }
  return data;
}

/**
 * Повертає ПРЯМИЙ URL файлу у Telegram CDN:
 * https://api.telegram.org/file/bot<token>/<file_path>
 */
async function tgGetFileUrl(env, fileId) {
  const token = env.TELEGRAM_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_TOKEN in env");

  const res = await fetch(tgApi(token, `getFile?file_id=${encodeURIComponent(fileId)}`));
  const data = await res.json();
  if (!data.ok || !data.result?.file_path) {
    console.error("TG API error: getFile", JSON.stringify(data));
    return null;
  }
  const filePath = data.result.file_path;
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

export { tgSendMessage, tgSendChatAction, tgGetFileUrl };