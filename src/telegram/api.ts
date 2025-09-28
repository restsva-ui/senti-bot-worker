// src/telegram/api.ts
export type TgEnv = { BOT_TOKEN: string };

export function makeTelegram(env: TgEnv) {
  if (!env.BOT_TOKEN) console.error("[tg] BOT_TOKEN is missing!");
  const base = `https://api.telegram.org/bot${env.BOT_TOKEN}`;

  async function sendMessage(chat_id: number, text: string) {
    const res = await fetch(`${base}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, text }),
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) console.error("[tg] sendMessage FAIL", res.status, body);
    else console.log("[tg] sendMessage OK");
    return res.ok;
  }

  async function answerCallback(callback_query_id: string) {
    const res = await fetch(`${base}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id }),
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) console.error("[tg] answerCallback FAIL", res.status, body);
    else console.log("[tg] answerCallback OK");
    return res.ok;
  }

  return { sendMessage, answerCallback };
}