// src/index.js
// Єдина точка входу: приймає Telegram webhook і прості службові GET-и.

import { handleTelegramUpdate } from "./router.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Проста перевірка "живий/готовий"
    if (request.method === "GET") {
      if (url.pathname === "/") return new Response("ok");
      if (url.pathname === "/health") {
        return Response.json({ ok: true, ts: Date.now() });
      }
    }

    // Прийом Telegram webhook
    if (request.method === "POST") {
      // 1) Перевіряємо секрет, якщо заданий
      if (env.WEBHOOK_SECRET) {
        const got = request.headers.get("x-telegram-bot-api-secret-token");
        if (!got || got !== env.WEBHOOK_SECRET) {
          return new Response("Forbidden (bad secret)", { status: 403 });
        }
      }

      try {
        const update = await request.json();
        await handleTelegramUpdate(update, env, ctx);
        return new Response("ok");
      } catch (err) {
        console.error("update error:", err);
        return new Response("Internal error", { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};