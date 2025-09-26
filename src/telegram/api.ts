// src/telegram/api.ts
import { getEnv } from "../config";

/** Побудова бази виду https://api.telegram.org/bot<token> */
function apiBase(): string {
  const env = getEnv();
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  const token = env.BOT_TOKEN;
  return `${base}/bot${token}`;
}

async function tgFetch<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const url = `${apiBase()}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Telegram ${method}: invalid JSON (${res.status})`);
  }

  if (!data.ok) {
    // не падаємо тихо — лог у воркері допоможе дебажити
    console.error("Telegram API error", method, data);
    throw new Error(`Telegram ${method} failed: ${data.description || res.status}`);
  }
  return data.result as T;
}

/** Надіслати повідомлення */
export async function sendMessage(
  chatId: number,
  text: string,
  extra?: Partial<{
    parse_mode: "Markdown" | "MarkdownV2" | "HTML";
    reply_markup: unknown;
    disable_web_page_preview: boolean;
    disable_notification: boolean;
  }>
) {
  const payload = { chat_id: chatId, text, ...(extra || {}) };
  return tgFetch("sendMessage", payload);
}

/** Редагувати текст повідомлення */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  extra?: Partial<{
    parse_mode: "Markdown" | "MarkdownV2" | "HTML";
    reply_markup: unknown;
    disable_web_page_preview: boolean;
  }>
) {
  const payload = { chat_id: chatId, message_id: messageId, text, ...(extra || {}) };
  return tgFetch("editMessageText", payload);
}

/**
 * answerCallbackQuery — «best-effort»:
 * якщо id не передано (твоя поточна router-логіка інколи не має його під рукою),
 * просто нічого не робимо, щоб не ламати потік.
 */
export async function answerCallbackQuery(text?: string, callbackQueryId?: string) {
  if (!callbackQueryId) {
    // Немає id — безпечний no-op
    return;
  }
  const payload: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (text) payload.text = text;
  return tgFetch("answerCallbackQuery", payload);
}