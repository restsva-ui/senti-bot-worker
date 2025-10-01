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

        // /ask <prompt> -> Gemini
        if (text?.startsWith("/ask") && chatId) {
          const prompt = text.replace(/^\/ask\s*/, "").trim();
          if (!prompt) {
            await tgSendMessage(env as any, chatId, "❗ Введи запит після /ask");
            return json({ ok: false, error: "empty prompt" }, 400);
          }

          try {
            const answer = await geminiAskText(env as any, prompt);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask" });
          } catch (e: any) {
            await tgSendMessage(
              env as any,
              chatId,
              `⚠️ Gemini error: ${e?.message || String(e)}`,
            );
            return json({ ok: false, error: "gemini failed" }, 500);
          }
        }

        // /ask_openrouter <prompt> -> OpenRouter
        if (text?.startsWith("/ask_openrouter") && chatId) {
          const prompt = text.replace(/^\/ask_openrouter\s*/, "").trim();
          if (!prompt) {
            await tgSendMessage(
              env as any,
              chatId,
              "❗ Введи запит після /ask_openrouter",
            );
            return json({ ok: false, error: "empty prompt" }, 400);
          }

          try {
            const answer = await openrouterAskText(env as any, prompt);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask_openrouter" });
          } catch (e: any) {
            await tgSendMessage(
              env as any,
              chatId,
              `⚠️ OpenRouter error: ${e?.message || String(e)}`,
            );
            return json({ ok: false, error: "openrouter failed" }, 500);
          }
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