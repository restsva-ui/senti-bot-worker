// src/telegram/api.ts
export type TgEnv = { BOT_TOKEN: string };

export function makeTelegram(env: TgEnv) {
  const token = env.BOT_TOKEN;
  if (!token) {
    console.error("[tg] BOT_TOKEN is missing!");
  }
  const base = `https://api.telegram.org/bot${token}`;

  async function sendJSON(path: string, payload: unknown) {
    const url = `${base}${path}`;
    const body = JSON.stringify(payload);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }).catch((e) => {
      console.error("[tg] fetch error:", String(e));
      return undefined as any;
    });

    if (!res) return false;

    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("[tg] FAIL", res.status, text);
      return false;
    }
    console.log("[tg] OK", path, text.slice(0, 200));
    return true;
  }

  function sendMessage(chat_id: number, text: string) {
    return sendJSON("/sendMessage", { chat_id, text });
  }

  function answerCallback(callback_query_id: string) {
    return sendJSON("/answerCallbackQuery", { callback_query_id });
  }

  return { sendMessage, answerCallback };
}