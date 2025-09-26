// src/telegram/api.ts
import { CFG, type Env } from "../config";

async function tgFetch<T>(
  env: Env,
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const url = `${CFG.apiBase(env)}/bot${CFG.botToken(env)}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });

  const data = await res.json<any>().catch(() => ({}));
  if (!data?.ok) {
    throw new Error(`Telegram ${method} failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.result as T;
}

export function sendMessage(
  env: Env,
  chat_id: number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return tgFetch(env, "sendMessage", {
    chat_id,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

export function editMessageText(
  env: Env,
  chat_id: number,
  message_id: number,
  text: string,
  extra: Record<string, unknown> = {}
) {
  return tgFetch(env, "editMessageText", {
    chat_id,
    message_id,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

export function answerCallbackQuery(
  env: Env,
  callback_query_id: string,
  text?: string,
  show_alert = false
) {
  return tgFetch(env, "answerCallbackQuery", {
    callback_query_id,
    ...(text ? { text } : {}),
    show_alert,
  });
}