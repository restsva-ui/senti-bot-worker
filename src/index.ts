// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";

export interface Env {
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string; // fallback
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { method } = request;
    const url = new URL(request.url);

    // healthcheck
    if (method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // Telegram webhook
    if (method === "POST" && url.pathname === "/webhook") {
      // 1) Перевіряємо секрет вебхука (fallback на WEBHOOK_SECRET)
      const expected = env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "";
      if (expected) {
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
        if (got !== expected) {
          return json({ ok: false, error: "invalid secret" }, 403);
        }
      }

      // 2) Зчитуємо апдейт
      let update: any = null;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }

      try {
        // 3) Обробка /ping у приватному чаті (просто і надійно)
        const msg = update?.message;
        const text: string | undefined = msg?.text;
        const chatId = msg?.chat?.id;

        if (text === "/ping" && chatId) {
          await pingCommand(env, chatId);
          return json({ ok: true, handled: "ping" });
        }

        // 4) Callback-кнопки (на майбутнє)
        const cb = update?.callback_query;
        if (cb?.id && cb?.message?.chat?.id) {
          await tgSendMessage(env, cb.message.chat.id, `tap: ${cb.data ?? ""}`);
          return json({ ok: true, handled: "callback" });
        }

        // 5) За замовчуванням — no-op
        return json({ ok: true, noop: true });
      } catch (e: any) {
        // Лог у воркері для діагностики
        console.error("Webhook error:", e?.message || e);
        return json({ ok: false, error: "internal" }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};