// src/index.ts
import { setEnv } from "./config";
import { handleUpdate } from "./router";

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    try {
      // Ініціалізуємо конфіг середовища (KV, токен, baseUrl тощо)
      setEnv(env);

      const url = new URL(request.url);

      // Головна сторінка для перевірки, що воркер живий
      if (url.pathname === "/") {
        return new Response("Senti bot online 🚀", {
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }

      // Обробка Telegram webhook
      if (url.pathname.startsWith("/webhook")) {
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }

        const update = await request.json<any>();
        // делегуємо роутеру
        await handleUpdate(update, ctx);
        return new Response("OK");
      }

      return new Response("Not found", { status: 404 });
    } catch (err: any) {
      console.error("Worker error:", err);
      return new Response("Internal Error: " + (err?.message || err), { status: 500 });
    }
  },
} satisfies ExportedHandler;