// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { handleDiagnostics } from "./diagnostics";
import { geminiGenerateText } from "./ai/gemini";

export interface Env {
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  // --- AI / провайдери
  CF_VISION: string;
  CLOUDFLARE_API_TOKEN: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  // Необов’язково: щоб явно вказати провайдера
  AI_PROVIDER?: "gemini" | "openrouter" | "cf-vision";
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // healthcheck
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // діагностика
    const diag = await handleDiagnostics(request, env as any, url);
    if (diag) return diag;

    // Telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      // Перевірка секрету (fallback на WEBHOOK_SECRET)
      const expected = env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "";
      if (expected) {
        const got =
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
        if (got !== expected) return json({ ok: false, error: "invalid secret" }, 403);
      }

      // Зчитуємо апдейт
      let update: any = null;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }

      try {
        // /ping
        const msg = update?.message;
        const text: string | undefined = msg?.text;
        const chatId = msg?.chat?.id;

        if (text === "/ping" && chatId) {
          await pingCommand(env as any, chatId);
          return json({ ok: true, handled: "ping" });
        }

        // Будь-який інший текст — генеруємо відповідь через Gemini
        if (chatId && typeof text === "string" && !text.startsWith("/")) {
          const prompt = text.trim();
          if (prompt.length > 0) {
            try {
              // якщо явно не вказано AI_PROVIDER, але є ключ Gemini — вважаємо, що використовуємо Gemini
              const provider = env.AI_PROVIDER ?? (env.GEMINI_API_KEY ? "gemini" : undefined);

              if (provider === "gemini") {
                const reply = await geminiGenerateText(env, prompt, {
                  model: "gemini-2.5-flash", // можна замінити на будь-яку з /diagnostics/ai/gemini/models
                  temperature: 0.7,
                });
                await tgSendMessage(env as any, chatId, reply);
                return json({ ok: true, handled: "gemini" });
              }

              // Якщо провайдер інший або не заданий — просто no-op (щоб нічого не зламати)
              await tgSendMessage(
                env as any,
                chatId,
                "⚠️ AI не налаштований. Доступні діагностичні ендпоїнти: /diagnostics",
              );
              return json({ ok: true, handled: "no-ai" });
            } catch (e: any) {
              await tgSendMessage(
                env as any,
                chatId,
                `❌ Помилка Gemini: ${e?.message || e}`,
              );
              return json({ ok: false, error: "gemini-failed" }, 500);
            }
          }
        }

        // callback query
        const cb = update?.callback_query;
        if (cb?.id && cb?.message?.chat?.id) {
          await tgSendMessage(
            env as any,
            cb.message.chat.id,
            `tap: ${cb.data ?? ""}`,
          );
          return json({ ok: true, handled: "callback" });
        }

        // no-op
        return json({ ok: true, noop: true });
      } catch (e: any) {
        console.error("Webhook error:", e?.message || e);
        return json({ ok: false, error: "internal" }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};