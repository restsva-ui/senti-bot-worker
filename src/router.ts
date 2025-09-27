// src/router.ts
import { sendMessage } from "./telegram/api";

type TgUser = { id: number; first_name?: string; username?: string };
type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel" };
type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; text?: string };
type TgCallback = { id: string; from: TgUser; message?: TgMessage; data?: string };
type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
};

const WEBHOOK_PATH = "/webhook/senti1984";

function ok(text = "ok") {
  return new Response(text, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}
function notFound() {
  // Повертай 200 замість 404, щоб Telegram не спамив помилками в getWebhookInfo
  return ok("");
}

async function handleUpdate(update: TgUpdate): Promise<Response> {
  // /ping у звичайних повідомленнях
  const msg = update.message;
  if (msg?.text && msg.text.trim().startsWith("/ping")) {
    await sendMessage(msg.chat.id, "✅ Pong");
    return ok();
  }

  // На інші апдейти поки мовчимо, але успішно відповідаємо
  return ok();
}

export default {
  async fetch(request: Request): Promise<Response> {
    const { method } = request;
    const url = new URL(request.url);

    // 1) Health-check
    if (method === "GET" && url.pathname === "/health") {
      return ok("healthy");
    }

    // 2) Telegram webhook
    if (method === "POST" && url.pathname === WEBHOOK_PATH) {
      try {
        const update = (await request.json()) as TgUpdate;
        return await handleUpdate(update);
      } catch {
        // Навіть якщо прилетіла невалідна JSON — не ламаємо вебхук, віддаємо 200
        return ok();
      }
    }

    // 3) Інші маршрути — гасимо 404
    return notFound();
  },
};