// src/commands.ts

export interface Env {
  BOT_TOKEN: string;
  API_BASE_URL?: string; // optional; defaults to https://api.telegram.org
}

/** Відповідь у чат: простий текст */
export type CommandResult = { text: string };

/** /ping */
export function cmdPing(): CommandResult {
  return { text: "pong ✅" };
}

/** /health (відповідь у чат) */
export function cmdHealthMessage(): CommandResult {
  return { text: "ok ✅" };
}

/** /start */
export function cmdStart(): CommandResult {
  return {
    text:
      "✅ Senti онлайн\n" +
      "Надішли /ping щоб перевірити відповідь.",
  };
}

/** JSON для GET /health (endpoint для моніторингу) */
export function healthJson(): Response {
  const body = JSON.stringify({ ok: true, ts: Date.now() });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** хелпер для відправки повідомлення у Telegram */
export async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string
): Promise<Response> {
  const base = env.API_BASE_URL?.replace(/\/+$/, "") || "https://api.telegram.org";
  const url = `${base}/bot${env.BOT_TOKEN}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  // Повертаємо як є (для логів/діагностики)
  return res;
}