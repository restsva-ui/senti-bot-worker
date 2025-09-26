// src/telegram/api.ts
import { CFG } from "../config";

// Базовий виклик до Telegram
async function call(method: string, body: unknown) {
  const url = `${CFG.apiBase()}/bot${CFG.botToken()}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Telegram API ${method} failed: ${res.status} ${text}`);
  }
  return res.json().catch(() => ({}));
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  extra?: Record<string, unknown>
) {
  return call("sendMessage", { chat_id: chatId, text, ...(extra || {}) });
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  extra?: Record<string, unknown>
) {
  return call("answerCallbackQuery", { callback_query_id: callbackQueryId, ...(extra || {}) });
}

export async function editMessageText(
  chatId: number | string,
  messageId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  return call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(extra || {}),
  });
}