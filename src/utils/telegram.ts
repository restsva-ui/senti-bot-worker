// src/utils/telegram.ts
export type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
};

const jsonHeaders = {
  "content-type": "application/json", // ✅ правильний заголовок
};

function tgBase(env: Env) {
  const base = env.API_BASE_URL?.trim() || "https://api.telegram.org";
  return `${base}/bot${env.BOT_TOKEN}`;
}

export async function tgSendMessage(
  env: Env,
  chat_id: number | string,
  text: string,
  extra: Record<string, unknown> = {}
) {
  const url = `${tgBase(env)}/sendMessage`;
  const body = JSON.stringify({ chat_id, text, ...extra });

  const res = await fetch(url, { method: "POST", headers: jsonHeaders, body });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || (data && data.ok === false)) {
    throw new Error(
      `Telegram sendMessage failed: status=${res.status} body=${JSON.stringify(
        data || {}
      )}`
    );
  }
  return data;
}

export async function tgAnswerCallbackQuery(
  env: Env,
  callback_query_id: string,
  text: string,
  show_alert = false
) {
  const url = `${tgBase(env)}/answerCallbackQuery`;
  const body = JSON.stringify({ callback_query_id, text, show_alert });

  const res = await fetch(url, { method: "POST", headers: jsonHeaders, body });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || (data && data.ok === false)) {
    throw new Error(
      `Telegram answerCallbackQuery failed: status=${res.status} body=${JSON.stringify(
        data || {}
      )}`
    );
  }
  return data;
}