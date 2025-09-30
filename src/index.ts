// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { handleDiagnostics } from "./diagnostics";
import { geminiAskText } from "./ai/gemini";
import { openrouterAskText } from "./ai/openrouter";

export interface Env {
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  // --- AI / провайдери
  CF_VISION: string;
  CLOUDFLARE_API_TOKEN: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // healthcheck
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // діагностика / ai
    const diag = await handleDiagnostics(request, env as any, url);
    if (diag) return diag;

    // Telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      // Перевірка секрету (fallback на WEBHOOK_SECRET)
      const expected = env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "";
      if (expected) {
        const got =
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
        if (got !== expected)
          return json({ ok: false, error: "invalid secret" }, 403);
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

        // Якщо прийшла звичайна текстова фраза — відповідаємо LLM
        if (text && chatId && !text.startsWith("/")) {
          let reply: string | null = null;

          // 1) primary: Gemini
          try {
            if (env.GEMINI_API_KEY) {
              reply = await geminiAskText(env as any, text);
            }
          } catch (e: any) {
            // падіння Gemini не ламає флоу — переходимо на fallback
            console.warn("Gemini failed, will try OpenRouter:", e?.message || e);
          }

          // 2) fallback: OpenRouter (лише якщо є ключ і попередній крок не дав відповіді)
          if (!reply && env.OPENROUTER_API_KEY) {
            try {
              reply = await openrouterAskText(env as any, text);
            } catch (e: any) {
              console.error("OpenRouter failed:", e?.message || e);
            }
          }

          // 3) Якщо нічого не вийшло — м’яке повідомлення користувачу
          if (!reply) {
            reply =
              "На жаль, зараз не можу відповісти. Спробуй ще раз трохи пізніше 🙏";
          }

          await tgSendMessage(env as any, chatId, reply);
          return json({ ok: true, handled: "chat" });
        }

        // callback
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