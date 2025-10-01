// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { handleDiagnostics } from "./diagnostics-ai";
import { normalizeLang, type Lang } from "./utils/i18n";

import { geminiAskText } from "./ai/gemini";
import { openrouterAskText } from "./ai/openrouter";

export interface Env {
  // Telegram
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  // AI keys
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  // CF flags (можуть бути, не використовуємо тут напряму)
  CF_VISION?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Акуратно вирізаємо аргумент після команди */
function extractArg(text: string, command: string): string {
  // приклади: "/ask Привіт", "/ask@YourBot Привіт"
  const noBot = text.replace(new RegExp(`^\\/${command}(?:@[\\w_]+)?\\s*`, "i"), "");
  return noBot.trim();
}

/** Отримуємо raw текст повідомлення з update */
function getIncomingText(update: any): string {
  return (
    update?.message?.text ??
    update?.edited_message?.text ??
    update?.callback_query?.message?.text ??
    ""
  );
}

/** language_code з Telegram (для bias у детекторі) */
function getTelegramLangCode(update: any): string | undefined {
  return (
    update?.message?.from?.language_code ||
    update?.edited_message?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    undefined
  );
}

/** Визначаємо бажану мову відповіді на основі контенту + Telegram language_code */
function decideLang(rawText: string, update: any): Lang {
  const tgCode = getTelegramLangCode(update);
  // normalizeLang вміє ігнорувати префікси команд і враховувати tgCode
  return normalizeLang(rawText || "", tgCode);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // healthcheck
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // діагностика (AI)
    const diag = await handleDiagnostics(request, env as any, url);
    if (diag) return diag;

    // Telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      // Перевірка секрету (fallback на WEBHOOK_SECRET)
      const expected = env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "";
      if (expected) {
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
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
        const msg = update?.message;
        const text: string | undefined = msg?.text;
        const chatId = msg?.chat?.id;

        // callback
        const cb = update?.callback_query;
        if (cb?.id && cb?.message?.chat?.id) {
          await tgSendMessage(env as any, cb.message.chat.id, `tap: ${cb.data ?? ""}`);
          return json({ ok: true, handled: "callback" });
        }

        if (typeof text === "string" && chatId) {
          const lang: Lang = decideLang(text, update);

          // /start, /help
          if (/^\/start(?:@\w+)?$/i.test(text) || /^\/help(?:@\w+)?$/i.test(text)) {
            await sendHelp(env as any, chatId, lang);
            return json({ ok: true, handled: "help" });
          }

          // /ping
          if (/^\/ping(?:@\w+)?$/i.test(text)) {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          // /ask_openrouter <текст>
          if (/^\/ask_openrouter(?:@\w+)?\b/i.test(text)) {
            const q = extractArg(text, "ask_openrouter");
            if (!q) {
              await tgSendMessage(env as any, chatId, lang === "uk"
                ? "Будь ласка, додай питання після команди."
                : lang === "ru"
                ? "Пожалуйста, добавь вопрос после команды."
                : lang === "de"
                ? "Bitte füge deine Frage nach dem Befehl hinzu."
                : "Please add your question after the command."
              );
              return json({ ok: true, handled: "ask_openrouter:empty" });
            }
            const answer = await openrouterAskText(env, q, lang);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask_openrouter" });
          }

          // /ask <текст> (Gemini)
          if (/^\/ask(?:@\w+)?\b/i.test(text)) {
            const q = extractArg(text, "ask");
            if (!q) {
              await tgSendMessage(env as any, chatId, lang === "uk"
                ? "Будь ласка, додай питання після команди."
                : lang === "ru"
                ? "Пожалуйста, добавь вопрос после команды."
                : lang === "de"
                ? "Bitte füge deine Frage nach dem Befehl hinzu."
                : "Please add your question after the command."
              );
              return json({ ok: true, handled: "ask:empty" });
            }
            const answer = await geminiAskText(env as any, q, lang);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask" });
          }

          // 🔄 Fallback: якщо повідомлення БЕЗ слеша — трактуємо як /ask (Gemini).
          // УВАГА: це навмисна зміна поведінки на краще (за твоїм запитом).
          if (!text.startsWith("/")) {
            const q = text.trim();
            if (q) {
              const answer = await geminiAskText(env as any, q, lang);
              await tgSendMessage(env as any, chatId, answer);
              return json({ ok: true, handled: "ask:plain-text" });
            }
          }
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