// src/index.ts
import type { TgUpdate } from "./types";
import { commandRouter } from "./router/commandRouter";

type Env = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  WEBHOOK_SECRET?: string; // опційно
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Проста перевірка живості
    if (request.method === "GET" && pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // TG webhook endpoint
    if (pathname === "/webhook" && request.method === "POST") {
      // 1) Перевіряємо секрет ТІЛЬКИ якщо він заданий у воркері
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      const need = env.WEBHOOK_SECRET;
      if (need && got !== need) {
        console.warn("Webhook secret mismatch (update пропущено)");
        return new Response("OK", { status: 200 }); // не ретраїмо TG
      }

      // 2) Читаємо апдейт і передаємо в роутер
      let update: TgUpdate | null = null;
      try {
        update = (await request.json()) as TgUpdate;
      } catch (e) {
        console.error("Bad JSON", e);
        return new Response("OK", { status: 200 });
      }

      try {
        const resp = await commandRouter(env as any, update);
        // роутер повертає Response; гарантуємо 200 для TG
        return resp ?? new Response("OK", { status: 200 });
      } catch (e) {
        console.error("Router error", e);
        // все одно відповідаємо 200, щоб TG не дудосив ретраями
        return new Response("OK", { status: 200 });
      }
    }

    // За замовчуванням
    return new Response("OK", { status: 200 });
  },
};