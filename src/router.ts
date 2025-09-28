// src/router.ts
import { sendMessage } from "./telegram/api";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // health
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "senti-bot-worker" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // простий тест відправки
    if (url.pathname.startsWith("/test/") && request.method === "GET") {
      const chatId = url.pathname.split("/").pop();
      const text = url.searchParams.get("text") ?? "test";
      try {
        await sendMessage(env.BOT_TOKEN, chatId!, text);
        return new Response("sent");
      } catch (e: any) {
        return new Response(`fail: ${e?.message ?? e}`, { status: 500 });
      }
    }

    // webhook
    if (url.pathname.startsWith("/webhook/") && request.method === "POST") {
      const update = await request.json().catch(() => null);
      console.log("[webhook] raw update:", JSON.stringify(update, null, 2));

      try {
        const msg = update?.message;
        const chatId = msg?.chat?.id;
        const text: string | undefined = msg?.text;

        if (chatId && typeof text === "string") {
          // важливо: точне порівняння на /ping
          if (text === "/ping") {
            await sendMessage(env.BOT_TOKEN, chatId, "pong ✅");
          } else if (text === "/health") {
            await sendMessage(env.BOT_TOKEN, chatId, "Worker alive 🚀");
          }
        }

        return new Response("ok");
      } catch (e: any) {
        console.error("[webhook] handler error", e);
        return new Response("error", { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;