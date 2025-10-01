// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { handleDiagnostics } from "./diagnostics";
import { sendHelp } from "./commands/help";
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
        // --- message-based
        const msg = update?.message;
        const text: string | undefined = msg?.text;
        const chatId: number | undefined = msg?.chat?.id;

        if (chatId && typeof text === "string") {
          const trimmed = text.trim();

          // /ping
          if (trimmed === "/ping") {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          // /help або /start
          if (trimmed === "/help" || trimmed === "/start") {
            await sendHelp(env as any, chatId);
            return json({ ok: true, handled: "help" });
          }

          // /ask <prompt> -> Gemini
          if (trimmed.startsWith("/ask ")) {
            const prompt = trimmed.slice(5).trim();
            if (!prompt) {
              await tgSendMessage(
                env as any,
                chatId,
                "❗️Використання: `/ask <текст>`",
                { parse_mode: "Markdown" },
              );
              return json({ ok: true, handled: "ask-usage" });
            }
            try {
              const answer = await geminiAskText(env as any, prompt);
              await tgSendMessage(env as any, chatId, answer);
              return json({ ok: true, handled: "ask-gemini" });
            } catch (e: any) {
              await tgSendMessage(
                env as any,
                chatId,
                `⚠️ Gemini: ${e?.message || "error"}`,
              );
              return json({ ok: false, error: "gemini-failed" }, 500);
            }
          }

          // /ask_openrouter <prompt> -> OpenRouter
          if (trimmed.startsWith("/ask_openrouter ")) {
            const prompt = trimmed.slice("/ask_openrouter ".length).trim();
            if (!prompt) {
              await tgSendMessage(
                env as any,
                chatId,
                "❗️Використання: `/ask_openrouter <текст>`",
                { parse_mode: "Markdown" },
              );
              return json({ ok: true, handled: "ask_openrouter-usage" });
            }
            try {
              const answer = await openrouterAskText(env as any, prompt);
              await tgSendMessage(env as any, chatId, answer);
              return json({ ok: true, handled: "ask-openrouter" });
            } catch (e: any) {
              await tgSendMessage(
                env as any,
                chatId,
                `⚠️ OpenRouter: ${e?.message || "error"}`,
              );
              return json({ ok: false, error: "openrouter-failed" }, 500);
            }
          }
        }

        // --- callback_query (кнопки)
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