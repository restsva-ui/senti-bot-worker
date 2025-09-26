// src/telegram/api.ts
import { getEnv } from "../config";

function apiBase(): string {
  const env = getEnv();
  const base = env.API_BASE_URL || "https://api.telegram.org";
  // гарантуємо один слеш у кінці
  return base.replace(/\/+$/, "");
}

function botToken(): string {
  return getEnv().BOT_TOKEN;
}

async function tgFetch<T>(method: string, body: unknown): Promise<T> {
  const url = `${apiBase()}/bot${botToken()}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Telegram API ${method} failed: ${res.status} ${txt}`);
  }
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`Telegram API ${method} error: ${data.description}`);
  return data.result as T;
}

export async function sendMessage(
  chat_id: number,
  text: string,
  extra?: Record<string, unknown>
) {
  return tgFetch("sendMessage", { chat_id, text, parse_mode: "Markdown", ...extra });
}

export async function editMessageText(
  chat_id: number,
  message_id: number,
  text: string,
  extra?: Record<string, unknown>
) {
  return tgFetch("editMessageText", {
    chat_id,
    message_id,
    text,
    parse_mode: "Markdown",
    ...extra,
  });
}

export async function answerCallbackQuery(text?: string, show_alert = false) {
  return tgFetch("answerCallbackQuery", { text, show_alert });
}