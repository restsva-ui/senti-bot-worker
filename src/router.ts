// src/router.ts
import { sendMessage, answerCallback } from "./telegram/api";

type TgUser = { id: number; is_bot?: boolean; first_name?: string; username?: string };
type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel" };
type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; date: number; text?: string };
type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string };
type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };

function json(status = 200, body: unknown = { ok: true }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // healthcheck (щоб /health не давав 404)
    if (url.pathname === "/health") {
      return json(200, { ok: true, service: "senti-bot-worker" });
    }

    // вебхук
    if (url.pathname.startsWith("/webhook/")) {
      if (request.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

      const update = (await request.json().catch(() => ({}))) as TgUpdate;

      // 1) Команда /ping
      const msg = update.message;
      if (msg?.text?.trim().toLowerCase() === "/ping") {
        await sendMessage(msg.chat.id, "pong ✅");
        return json(); // 200
      }

      // 2) Callback (на майбутнє – просто safe-ack)
      const cb = update.callback_query;
      if (cb?.id) {
        await answerCallback(cb.id);
        return json();
      }

      // 3) Fallback – тихо Ok
      return json();
    }

    // 404 для інших шляхів
    return new Response("Not found", { status: 404 });
  },
};