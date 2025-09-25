// src/telegram/index.ts

export interface TgEnv {
  BOT_TOKEN: string;
  API_BASE_URL?: string; // дефолт https://api.telegram.org
}

function baseUrl(env: TgEnv): string {
  const api = env.API_BASE_URL ?? "https://api.telegram.org";
  return `${api}/bot${env.BOT_TOKEN}`;
}

async function callTelegram<T = any>(
  env: TgEnv,
  method: string,
  payload: Record<string, any>
): Promise<T> {
  const res = await fetch(`${baseUrl(env)}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Telegram ${method} failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

/**
 * Надіслати текстове повідомлення
 */
export async function sendMessage(
  env: TgEnv,
  chat_id: number | string,
  text: string,
  extra: Record<string, any> = {}
) {
  return callTelegram(env, "sendMessage", { chat_id, text, ...extra });
}

/**
 * Відповісти на callback_query (натискання інлайн-кнопок)
 */
export async function answerCallbackQuery(
  env: TgEnv,
  callback_query_id: string,
  extra: Record<string, any> = {}
) {
  return callTelegram(env, "answerCallbackQuery", {
    callback_query_id,
    ...extra,
  });
}