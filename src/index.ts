// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { handleDiagnostics } from "./diagnostics-ai";
import { normalizeLang, type Lang } from "./utils/i18n";
import { askSmart, quickTemplateReply, type ReplierEnv } from "./services/replier";

export interface Env extends ReplierEnv {
  // Telegram
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string; // якщо задано — звіряємо
  WEBHOOK_SECRET?: string;        // альтернативне поле

  // Інше (не обов’язково використовуються тут)
  CF_VISION?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Дістаємо з апдейта chatId і текст, враховуючи різні типи апдейтів */
function getMessageInfo(update: any): { chatId?: number; text?: string; fromLangCode?: string } {
  const msg =
    update?.message ||
    update?.edited_message ||
    update?.channel_post ||
    update?.callback_query?.message ||
    null;

  const chatId: number | undefined = msg?.chat?.id;
  const text: string | undefined =
    update?.message?.text ||
    update?.edited_message?.text ||
    update?.channel_post?.text ||
    update?.callback_query?.message?.text ||
    undefined;

  const fromLangCode: string | undefined =
    update?.message?.from?.language_code ||
    update?.edited_message?.from?.language_code ||
    update?.channel_post?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    undefined;

  return { chatId, text, fromLangCode };
}

/** Виділяє слово після команди (/ask …) */
function extractArg(text: string, command: string): string {
  const noBot = text.replace(new RegExp(`^\\/${command}(?:@\\w+)?\\s*`, "i"), "");
  return noBot.trim();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Healthcheck
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // Diagnostics passthrough
    const diag = await handleDiagnostics(request, env as any, url);
    if (diag) return diag;

    // Telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      // Перевірка секрету: якщо задано хоча б одне поле — вимагаємо збіг
      const expected = (env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "").trim();
      if (expected) {
        const got = (request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
        if (got !== expected) {
          return json({ ok: false, error: "invalid secret" }, 403);
        }
      }

      // Читаємо апдейт
      let update: any = null;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }

      const { chatId, text, fromLangCode } = getMessageInfo(update);

      try {
        // Callback-кнопки — просте echo
        if (update?.callback_query?.id && chatId) {
          await tgSendMessage(env as any, chatId, `tap: ${update?.callback_query?.data ?? ""}`);
          return json({ ok: true, handled: "callback" });
        }

        if (typeof text === "string" && chatId) {
          const trimmed = text.trim();

          // /start | /help
          if (/^\/start(?:@\w+)?$/i.test(trimmed) || /^\/help(?:@\w+)?$/i.test(trimmed)) {
            // Визначати мову для допомоги немає сенсу по кожній лінії, досить загальної
            const langForHelp: Lang = normalizeLang(trimmed, fromLangCode);
            await sendHelp(env as any, chatId, langForHelp);
            return json({ ok: true, handled: "help" });
          }

          // /ping
          if (/^\/ping(?:@\w+)?$/i.test(trimmed)) {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          // /ask … → smart router (шаблони → KV → Gemini → OpenRouter)
          if (/^\/ask(?:@\w+)?\b/i.test(trimmed)) {
            const q = extractArg(trimmed, "ask");
            const question = q || trimmed.replace(/^\/ask(?:@\w+)?\b/i, "").trim();

            if (!question) {
              await tgSendMessage(env as any, chatId, "Будь ласка, додай питання після команди.");
              return json({ ok: true, handled: "ask:empty" });
            }

            // >>> Ключове: мову визначаємо ПО КОНКРЕТНОМУ ЗАПИТУ
            const qLang: Lang = normalizeLang(question, fromLangCode);

            // миттєва відповідь для дуже коротких реплік (на мові qLang)
            const quick = quickTemplateReply(qLang, question);
            if (quick) {
              await tgSendMessage(env as any, chatId, quick);
              return json({ ok: true, handled: "template" });
            }

            const { text: answer } = await askSmart(env, question, qLang);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask" });
          }

          // Fallback: звичайний текст — як /ask
          if (trimmed.length > 0) {
            const msgLang: Lang = normalizeLang(trimmed, fromLangCode);

            const quick = quickTemplateReply(msgLang, trimmed);
            if (quick) {
              await tgSendMessage(env as any, chatId, quick);
              return json({ ok: true, handled: "template:plain" });
            }

            const { text: answer } = await askSmart(env, trimmed, msgLang);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask:fallback" });
          }
        }

        // Якщо сюди дійшли — нічого не зробили (не текст/нема chatId)
        return json({ ok: true, noop: true });
      } catch (e: any) {
        // Не мовчимо: намагаємось повідомити користувача про помилку
        try {
          const { chatId: safeChat } = getMessageInfo(update);
          if (safeChat) {
            await tgSendMessage(
              env as any,
              safeChat,
              `Вибач, сталася внутрішня помилка: ${e?.message || String(e)}`
            );
          }
        } catch {
          // ігноруємо, щоб точно не впасти
        }
        return json({ ok: false, error: "internal" }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};