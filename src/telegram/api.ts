// src/telegram/api.ts
import { CFG } from "../config";

type ReplyMarkup =
  | { inline_keyboard: { text: string; callback_data: string }[][] }
  | { keyboard: { text: string }[][]; resize_keyboard?: boolean; one_time_keyboard?: boolean }
  | undefined;

async function tgFetch(method: string, body: Record<string, unknown>) {
  const url = `${CFG.apiBase}/bot${CFG.botToken}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Telegram ${method} failed: ${res.status} ${txt}`);
  }
  return (await res.json()) as unknown;
}

export async function sendMessage(
  chat_id: number,
  text: string,
  replyMarkup?: ReplyMarkup
) {
  const body: any = {
    chat_id,
    text,
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup; // ← гарантія, що markup піде у запит
  return await tgFetch("sendMessage", body);
}

export async function answerCallbackQuery(
  callback_query_id: string,
  text?: string
) {
  const body: any = { callback_query_id };
  if (text) body.text = text;
  return await tgFetch("answerCallbackQuery", body);
}