// Telegram API helpers (Cloudflare Workers, TypeScript)

import { getEnv } from "../config";

/** Базовий URL типу: https://api.telegram.org/bot<token> */
function apiBase(): string {
  const base = getEnv().API_BASE_URL || "https://api.telegram.org";
  const token = getEnv().BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN missing");
  return `${base.replace(/\/+$/, "")}/bot${token}`;
}

async function tgFetch<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const url = `${apiBase()}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json<any>();
  if (!data?.ok) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.result as T;
}

export async function sendMessage(chat_id: number, text: string, extra: Record<string, unknown> = {}) {
  return tgFetch("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
}

export async function editMessageText(
  chat_id: number,
  message_id: number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return tgFetch("editMessageText", {
    chat_id,
    message_id,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

/** Обов'язково передаємо callback_query_id */
export async function answerCallbackQuery(callback_query_id: string, text?: string, show_alert = false) {
  return tgFetch("answerCallbackQuery", {
    callback_query_id,
    ...(text ? { text } : {}),
    show_alert,
  });
}