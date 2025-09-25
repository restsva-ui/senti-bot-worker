// src/telegram/index.ts
// Уніфіковані хелпери Telegram API, які імпортуються як "../telegram" або "./telegram"

type TGEnv = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
};

function apiBase(env: TGEnv) {
  const base = env.API_BASE_URL ?? "https://api.telegram.org";
  return `${base}/bot${env.BOT_TOKEN}`;
}

export async function sendMessage(
  env: TGEnv,
  chat_id: number | string,
  text: string,
  extra: Record<string, any> = {}
) {
  const resp = await fetch(`${apiBase(env)}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, text, ...extra })
  });
  if (!resp.ok) {
    throw new Error(`sendMessage failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

export async function answerCallbackQuery(
  env: TGEnv,
  params: {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
    url?: string;
    cache_time?: number;
  }
) {
  const resp = await fetch(`${apiBase(env)}/answerCallbackQuery`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params)
  });
  if (!resp.ok) {
    throw new Error(`answerCallbackQuery failed: ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}
