// src/router.ts
import { makeTelegram, TgEnv } from "./telegram/api";

type TgUser = { id: number; username?: string };
type TgChat = { id: number; type: string };
type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; date: number; text?: string };
type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string };
type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };

function json(status = 200, data: unknown = { ok: true }) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(req: Request, env: TgEnv): Promise<Response> {
    const url = new URL(req.url);
    const tg = makeTelegram(env);

    // health (GET/POST)
    if (url.pathname === "/health") {
      return json(200, { ok: true, service: "senti-bot-worker" });
    }

    // ручний тест: /test/<chatId>?text=...
    if (url.pathname.startsWith("/test/")) {
      const chatId = Number(url.pathname.split("/").pop());
      const text = url.searchParams.get("text") ?? "test from worker";
      console.log("[test] send to", chatId, "text:", text);
      await tg.sendMessage(chatId, text);
      return json(200, { sent: true, chatId, text });
    }

    // Webhook
    if (url.pathname.startsWith("/webhook/")) {
      if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

      const update = (await req.json().catch(() => ({}))) as TgUpdate;
      console.log("[webhook] update:", JSON.stringify(update));

      const msg = update.message;
      const cb = update.callback_query;

      // Прямий хендлер /ping
      const text = msg?.text?.trim() ?? "";
      if (text.toLowerCase().startsWith("/ping")) {
        await tg.sendMessage(msg!.chat.id, "pong ✅");
        return json();
      }

      // Echo для діагностики
      if (text) {
        await tg.sendMessage(msg!.chat.id, `echo: ${text}`);
        return json();
      }

      // Callback
      if (cb?.id) {
        await tg.answerCallback(cb.id);
        return json();
      }

      return json();
    }

    return new Response("Not found", { status: 404 });
  },
};