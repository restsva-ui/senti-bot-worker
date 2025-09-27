// src/router.ts
import { sendMessage } from "./telegram/api";

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel" };
type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; text?: string };
type TgCallback = { id: string; from: TgUser; message?: TgMessage; data?: string };
type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallback };

const WEBHOOK_PATH = "/webhook/senti1984";

function ok(text = "ok") {
  return new Response(text, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

async function handleUpdate(update: TgUpdate): Promise<Response> {
  const msg = update.message;
  if (msg?.text?.trim().startsWith("/ping")) {
    await sendMessage(msg.chat.id, "✅ Pong");
    return ok();
  }
  return ok(); // інші апдейти підтверджуємо 200
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // 1) Health-check: приймаємо і GET, і POST
    if (url.pathname === "/health") {
      return ok("healthy");
    }

    // 2) Telegram webhook
    if (request.method === "POST" && url.pathname === WEBHOOK_PATH) {
      try {
        const update = (await request.json()) as TgUpdate;
        return await handleUpdate(update);
      } catch {
        return ok(); // не валимо вебхук навіть на кривому JSON
      }
    }

    // 3) Решта маршрутів — тиха 200, щоб не плодити 404 у getWebhookInfo
    return ok("");
  },
};