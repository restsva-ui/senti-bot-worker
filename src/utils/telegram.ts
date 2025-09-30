// src/utils/telegram.ts
// Єдиний низькорівневий хелпер Telegram API, без циклічних імпортів.

export type TgEnv = {
  BOT_TOKEN: string;
  API_BASE_URL?: string; // за замовчуванням https://api.telegram.org
};

function apiBase(env: TgEnv) {
  const base = env.API_BASE_URL ?? "https://api.telegram.org";
  return `${base}/bot${env.BOT_TOKEN}`;
}

export async function tgCall<T = any>(env: TgEnv, method: string, payload: any): Promise<T> {
  const resp = await fetch(`${apiBase(env)}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    console.error(`tgCall ${method} failed:`, resp.status, t);
    throw new Error(`tg ${method} ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export async function sendMessage(
  env: TgEnv,
  chat_id: number | string,
  text: string,
  extra: Record<string, any> = {}
) {
  return tgCall(env, "sendMessage", { chat_id, text, ...extra });
}

export async function editMessageText(
  env: TgEnv,
  chat_id: number | string,
  message_id: number,
  text: string,
  extra: Record<string, any> = {}
) {
  return tgCall(env, "editMessageText", { chat_id, message_id, text, ...extra });
}

export async function answerCallbackQuery(
  env: TgEnv,
  callback_query_id: string,
  params: { text?: string; show_alert?: boolean; url?: string; cache_time?: number } = {}
) {
  return tgCall(env, "answerCallbackQuery", { callback_query_id, ...params });
}