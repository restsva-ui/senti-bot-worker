// src/index.js
import { tgSendMessage } from "./adapters/telegram.js";

function extractChat(update) {
  return (
    update?.message?.chat?.id ??
    update?.edited_message?.chat?.id ??
    update?.callback_query?.message?.chat?.id ??
    null
  );
}

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // 1) Healthcheck
      if (request.method === "GET") {
        if (url.pathname === "/ping") {
          // тестове повідомлення в OWNER_ID (за наявності)
          const owner = env.OWNER_ID;
          if (owner) await tgSendMessage(owner, "✅ Ping від воркера", env);
          return new Response("pong", { status: 200 });
        }
        return new Response("Senti worker alive", { status: 200 });
      }

      // 2) Приймаємо POST з Telegram на БУДЬ-ЯКИЙ шлях
      if (request.method === "POST") {
        let update = null;
        try {
          update = await request.json();
        } catch {
          return new Response("bad json", { status: 400 });
        }

        // лог ключів апдейта у Tail
        console.log("TG update keys:", Object.keys(update || {}));

        const chatId = extractChat(update);
        if (!chatId) {
          console.log("No chatId in update");
          return new Response("ok", { status: 200 });
        }

        // Миттєва відповідь користувачу (без роутера)
        await tgSendMessage(
          chatId,
          "👋 Привіт! Я на звʼязку. Це технічний пінг від воркера.",
          env
        );

        // Обовʼязково швидкий 200
        return new Response("ok", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error("fetch error:", e?.stack || e);
      return new Response("error", { status: 500 });
    }
  },
};