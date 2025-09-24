// src/index.js
import { handleUpdate } from "./router.js";
import { tgSendMessage } from "./adapters/telegram.js";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname || "/";

      // Шлях вебхука: беремо з середовища або приймаємо будь-який
      const hookPath = (env.BOT_PATH || "/senti1984").trim();
      const match = pathname === hookPath || hookPath === "/*";

      if (request.method === "POST" && match) {
        const update = await request.json().catch(() => null);

        // базове логування (видно у Tail)
        console.log("TG update:", update && Object.keys(update));

        if (!update) return new Response("bad json", { status: 400 });

        // головне: ЧЕКАЄМО роутер
        await handleUpdate(update, env);

        // Telegram очікує швидку відповідь 200/“ok”
        return new Response("ok", { status: 200 });
      }

      // healthcheck / простий пінг
      if (request.method === "GET") {
        return new Response("Senti bot worker OK", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error("fetch error:", e?.stack || e);
      // Спробуємо сповістити власника, якщо в апдейті був chat_id
      try {
        const cached = await request.clone().json().catch(() => null);
        const chatId =
          cached?.message?.chat?.id ||
          cached?.callback_query?.message?.chat?.id;
        if (chatId && typeof tgSendMessage === "function") {
          await tgSendMessage(chatId, "Виникла помилка на боці сервера 🛠️. Ми вже дивимось.");
        }
      } catch (_) {}
      return new Response("error", { status: 500 });
    }
  },
};