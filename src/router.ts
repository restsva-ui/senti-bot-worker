// src/router.ts
import { sendMessage, answerCallback } from "./telegram/api";

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);

    // health
    if (url.pathname === "/health") return new Response("ok", { status: 200 });

    // DIAG: ручна перевірка відправки
    // GET/POST /diag/send?chat_id=784869835&text=hello
    if (url.pathname === "/diag/send") {
      const chatId = url.searchParams.get("chat_id");
      const text = url.searchParams.get("text") || "diag";
      try {
        await sendMessage(env, chatId!, text);
        return new Response("diag: ok", { status: 200 });
      } catch (e: any) {
        console.error("[diag] send fail:", e?.message || e);
        return new Response("diag: fail", { status: 500 });
      }
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
        // callback
        if (update.callback_query) {
          await answerCallback(env, update.callback_query.id, "✅");
          return new Response("ok", { status: 200 });
        }

        const msg = update.message;
        if (msg?.text) {
          const chatId = msg.chat.id;
          let cmd = String(msg.text).trim();
          if (cmd.startsWith("/")) {
            cmd = cmd.split(" ")[0]; // /ping@user -> /ping
            cmd = cmd.split("@")[0];
          }
          console.log("[router] cmd:", cmd);

          if (cmd === "/ping") {
            await sendMessage(env, chatId, "pong ✅");
            return new Response("ok", { status: 200 });
          }
        }

        return new Response("ok", { status: 200 });
      } catch (e: any) {
        console.error("[webhook] handler error:", e?.message || e);
        return new Response("ok", { status: 200 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
};