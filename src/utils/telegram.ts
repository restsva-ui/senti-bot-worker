// src/utils/telegram.ts
import type { Env } from "../index";

const jsonHeaders = { "Content-Type": "application/json" };

function apiBase(env: Env) {
  // Дозволяє використовувати власний базовий URL (напр. api.telegram.org)
  const base = (env as any).API_BASE_URL || "https://api.telegram.org";
  return `${base}/bot${env.BOT_TOKEN}`;
}

async function tgPost<T = any>(
  env: Env,
  method: string,
  body: Record<string, any>
): Promise<T> {
  const res = await fetch(`${apiBase(env)}/${method}`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telegram ${method} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export async function sendMessage(env: Env, chatId: number, text: string) {
  return tgPost(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
}

export async function answerCallbackQuery(env: Env, cbId: string, text?: string) {
  return tgPost(env, "answerCallbackQuery", {
    callback_query_id: cbId,
    text,
    show_alert: false,
  });
}

export async function setWebhook(env: Env, url: string) {
  return tgPost(env, "setWebhook", {
    url,
    allowed_updates: ["message", "callback_query"],
    max_connections: 40,
    drop_pending_updates: false,
  });
}

/**
 * Реєструємо менюшку команд Telegram, щоб у списку після "/" була і /wiki.
 * Викличемо це у /start (наступним кроком додамо один рядок у index.ts).
 */
export async function setMyCommands(env: Env) {
  const commands = [
    { command: "start",  description: "запуск і вітання" },
    { command: "ping",   description: "перевірка зв’язку" },
    { command: "health", description: "перевірка стану сервера" },
    { command: "help",   description: "список команд" },
    { command: "wiki",   description: "стислий опис з Вікі" },
  ];
  return tgPost(env, "setMyCommands", { commands });
}