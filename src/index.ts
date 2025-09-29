// src/index.ts
import type { TgUpdate } from "./types";
import { commandRouter } from "./router/commandRouter";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  WEBHOOK_SECRET?: string;
  LIKES_KV?: KVNamespace;
};

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    // простий healthcheck
    if (request.method === "GET" && pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // Telegram надсилає POST на корінь (той самий URL, що у setWebhook)
    if (request.method === "POST" && pathname === "/") {
      // 1) Перевірка секрету (якщо заданий)
      const got = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
      if (env.WEBHOOK_SECRET && got !== env.WEBHOOK_SECRET) {
        console.log("Webhook: secret mismatch", {
          haveSecret: !!env.WEBHOOK_SECRET,
          gotLen: got.length,
        });
        return new Response("UNAUTHORIZED", { status: 401 });
      }

      // 2) Парсимо апдейт і віддаємо в роутер
      try {
        const update = (await request.json()) as TgUpdate;
        // Трохи діагностики у логи
        const kind = update.message ? "message"
          : update.callback_query ? "callback_query"
          : update.edited_message ? "edited_message"
          : "other";
        console.log("Webhook: update kind =", kind);

        return await commandRouter(env, update);
      } catch (err) {
        console.error("Webhook: parsing/route error", err);
        return new Response("BAD_REQUEST", { status: 400 });
      }
    }

    // решта — просто 200, щоб не лякати сканери
    return new Response("OK", { status: 200 });
  },
} satisfies ExportedHandler<Env>;