// Lightweight entry for Telegram webhook on /senti1984
import { handleUpdate } from "./router.js";

export default {
  async fetch(request, env, ctx) {
    try {
      const { pathname } = new URL(request.url);

      // Telegram webhook
      if (request.method === "POST" && pathname === "/senti1984") {
        // Безпечно парсимо апдейт
        let update = null;
        try { update = await request.json(); } catch (_) {}

        if (update) {
          // Обробляємо у бекграунді, щоб швидко відповісти Telegram
          ctx.waitUntil(handleUpdate(update, env));
        }
        // миттєва відповідь для Telegram
        return new Response("ok");
      }

      // Healthcheck / простий GET
      if (request.method === "GET") {
        return new Response("Senti bot worker is up ✅", { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      // Ніколи не завалюємо вебхук
      return new Response("ok");
    }
  },
};