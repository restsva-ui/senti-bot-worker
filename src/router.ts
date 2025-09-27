// src/router.ts
import { sendMessage, answerCallback } from "./telegram/api";

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // health
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // вебхук
    if (request.method === "POST" && url.pathname.startsWith("/webhook/")) {
      let update: any = null;
      try {
        update = await request.json();
        console.log("[webhook] raw update:", JSON.stringify(update));
      } catch (e) {
        console.error("[webhook] bad json", e);
        return new Response("bad json", { status: 400 });
      }

      try {
        // callback_query
        if (update.callback_query) {
          const cq = update.callback_query;
          await answerCallback(env, cq.id, "✅");
          return new Response("ok", { status: 200 });
        }

        // message/commands
        const msg = update.message;
        if (msg?.text) {
          const chatId = msg.chat.id;
          let text = String(msg.text).trim();

          // Нормалізуємо команду: /ping або /ping@username
          if (text.startsWith("/")) {
            text = text.split(" ")[0]; // беремо тільки команду
            text = text.split("@")[0]; // відкидаємо @username
          }

          if (text === "/ping") {
            await sendMessage(env, chatId, "pong ✅");
            return new Response("ok", { status: 200 });
          }
        }

        // Фолбек: нічого не зробили — але відповімо 200, щоб TG не ретраїв
        return new Response("ok", { status: 200 });
      } catch (e: any) {
        console.error("[webhook] handler error:", e?.message || e);
        // все одно 200, щоб не накопичувались pending updates
        return new Response("ok", { status: 200 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};