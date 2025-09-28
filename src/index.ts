import { handleHelp } from "./commands/help";

export interface Env {
  BOT_TOKEN: string;
  API_BASE_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Health-check
    if (pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Webhook
    if (pathname.startsWith("/webhook")) {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const update = await request.json<{ message?: any }>();
      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text;

        if (text === "/ping") {
          await sendMessage(env, chatId, "pong ✅");
        } else if (text === "/health") {
          await sendMessage(env, chatId, "ok ✅");
        } else if (text === "/start") {
          await sendMessage(
            env,
            chatId,
            "✅ Senti онлайн\nНадішли /ping щоб перевірити відповідь."
          );
        } else if (text === "/help") {
          await handleHelp(env, chatId);
        }
      }

      return new Response("ok", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
};

// Відправка повідомлення
async function sendMessage(env: Env, chatId: number, text: string) {
  const url = `${env.API_BASE_URL}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: "Markdown" };

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}