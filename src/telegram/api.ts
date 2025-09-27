// src/telegram/api.ts
// Мінімальний Telegram API-шар для Worker.
// Експортує sendMessage та answerCallback, які очікує router.ts.

import { CFG } from "../config";

// Будуємо базову URL до Telegram Bot API
function apiBase(): string {
  const base = CFG.API_BASE_URL || "https://api.telegram.org";
  // BOT_TOKEN обовʼязково має бути доданий як secret: `wrangler secret put BOT_TOKEN`
  const token = CFG.BOT_TOKEN;
  return `${base.replace(/\/+$/, "")}/bot${token}`;
}

// Відправка звичайного повідомлення
export async function sendMessage(
  chatId: number,
  text: string,
  reply_markup?: unknown
): Promise<Response> {
  const url = `${apiBase()}/sendMessage`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (reply_markup) body.reply_markup = reply_markup;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

// Відповідь на натискання inline-кнопок (callback_query)
// Викликається з router.ts → answerCallback(...)
export async function answerCallback(
  callback_query_id: string,
  text?: string,
  show_alert?: boolean
): Promise<Response> {
  const url = `${apiBase()}/answerCallbackQuery`;
  const body: Record<string, unknown> = { callback_query_id };
  if (text) body.text = text;
  if (show_alert !== undefined) body.show_alert = show_alert;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}