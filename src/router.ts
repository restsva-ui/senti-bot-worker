// src/router.ts
import { makeTelegram, TgEnv } from "./telegram/api";

type TgUser = { id: number; username?: string };
type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel" };
type TgMessage = { message_id: number; from?: TgUser; chat: TgChat; date: number; text?: string };
type TgCallbackQuery = { id: string; from: TgUser; message?: TgMessage; data?: string };
type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };

function j(status = 200, body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: TgEnv): Promise<Response> {
    const url = new URL(request.url);
    const tg = makeTelegram(env);

    if (url.pathname === "/health") return j(200, { ok: true, service: "senti-bot-worker" });

    if (url.pathname.startsWith("/webhook/")) {
      if (request.method !== "POST") return j(405, { ok: false, error: "method not allowed" });

      const update = (await request.json().catch(() => ({}))) as TgUpdate;
      console.log("[webhook] update:", JSON.stringify(update));

      // 1) Прямий хендлер /ping
      const msg = update.message;
      const text = msg?.text?.trim() ?? "";

      if (text.toLowerCase().startsWith("/ping")) {
        await tg.sendMessage(msg!.chat.id, "pong ✅");
        return j();
      }

      // 2) Echo-діагностика (тимчасово). Якщо текст є — відповімо,
      // щоб упевнитись, що виклик Telegram API проходить.
      if (text) {
        await tg.sendMessage(msg!.chat.id, `echo: ${text}`);
        return j();
      }

      // 3) Callback (на випадок кнопок)
      const cb = update.callback_query;
      if (cb?.id) {
        await tg.answerCallback(cb.id);
        return j();
      }

      return j();
    }

    return new Response("Not found", { status: 404 });
  },
};