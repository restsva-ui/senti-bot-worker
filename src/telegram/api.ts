// src/telegram/api.ts

import { getEnv } from "../config";

type SendOpts = {
  reply_markup?: any;
  parse_mode?: "Markdown" | "MarkdownV2" | "HTML";
  disable_web_page_preview?: boolean;
  reply_to_message_id?: number;
};

function tgUrl(method: string): string {
  const { API_BASE_URL, BOT_TOKEN } = getEnv();
  // приклад: https://api.telegram.org/bot<token>/sendMessage
  return `${API_BASE_URL}/bot${BOT_TOKEN}/${method}`;
}

async function tgPost<T = any>(method: string, payload: Record<string, any>): Promise<T> {
  const url = tgUrl(method);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Telegram ${method} failed: ${res.status} ${txt}`);
  }
  const json = (await res.json()) as { ok: boolean; result: T };
  if (!json.ok) throw new Error(`Telegram ${method} responded ok=false`);
  return json.result;
}

// ───────── public API ─────────

export async function sendMessage(
  chat_id: number,
  text: string,
  opts: SendOpts = {}
) {
  return tgPost("sendMessage", { chat_id, text, ...opts });
}

export async function editMessageText(
  chat_id: number,
  message_id: number,
  text: string,
  opts: SendOpts = {}
) {
  return tgPost("editMessageText", { chat_id, message_id, text, ...opts });
}

export async function answerCallbackQuery(
  text?: string,
  show_alert = false
) {
  // заувага: інлайн-ід ми передаємо з router через update.callback_query.id
  // але щоб не тягнути весь update сюди, читаємо його з опцій у виклику:
  // ми домовилися викликати без id — тоді воркер просто проігнорує,
  // або ж ти можеш додати поле "callback_query_id" коли потрібно.
  // Для сумісності робимо два варіанти підпису:
  const payload: Record<string, any> = (globalThis as any).__cbqPayload__ || {};
  if (!payload.callback_query_id) {
    // м’яко ігноруємо, щоб не роняти запит
    return { skipped: true };
  }
  if (text) payload.text = text;
  if (show_alert) payload.show_alert = true;
  return tgPost("answerCallbackQuery", payload);
}

// допоміжний хелпер для router.ts: перед викликом answerCallbackQuery
// виставляємо ID з апдейта (щоб не тягнути залежності сюди)
export function primeCallbackQueryId(id: string) {
  (globalThis as any).__cbqPayload__ = { callback_query_id: id };
}