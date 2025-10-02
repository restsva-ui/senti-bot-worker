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

/** Акуратний детект мови: враховує і текст, і language_code */
function detectLang(update: any): Lang {
  const code: string | undefined =
    update?.message?.from?.language_code ||
    update?.edited_message?.from?.language_code ||
    update?.channel_post?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    undefined;

  const text: string =
    update?.message?.text ||
    update?.edited_message?.text ||
    update?.channel_post?.text ||
    update?.callback_query?.message?.text ||
    "";

  return normalizeLang(text, code);
}

/** Виділяє слово після команди (/ask …) */
function extractArg(text: string, command: string): string {
  const noBot = text.replace(new RegExp(`^\\/${command}(?:@\\w+)?\\s*`, "i"), "");
  return noBot.trim();
}

/** Дістаємо з апдейта chatId і текст, враховуючи різні типи апдейтів */
function getMessageInfo(update: any): { chatId?: number; text?: string } {
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

  return { chatId, text };
}

/* ---------- НОВЕ: по-рядкова обробка ---------- */

/** Розбиває повідомлення користувача на «рядки-кандидати» для окремих відповідей. */
function splitUserLines(s: string): string[] {
  return (s || "")
    .split(/\r?\n+/)
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

/** Відповідь для одного рядка з окремим визначенням мови. */
async function answerOneLine(env: Env, line: string, tgLangCode?: string): Promise<string> {
  const lineLang = normalizeLang(line, tgLangCode);

  // Миттєвий шаблон — якщо спрацює, не звертаємось до моделей.
  const quick = quickTemplateReply(lineLang, line);
  if (quick) return quick;

  const { text } = await askSmart(env, line, lineLang);
  return (text || "").trim();
}

/** Послідовно обробляє всі рядки, щоб не ловити rate-limit і зберегти порядок. */
async function answerMultiLine(env: Env, text: string, tgLangCode?: string): Promise<string> {
  const lines = splitUserLines(text);
  if (lines.length === 0) return "";

  const parts: string[] = [];
  for (const ln of lines) {
    try {
      const ans = await answerOneLine(env, ln, tgLangCode);
      parts.push(ans);
    } catch (e: any) {
      parts.push(`⚠️ ${e?.message || String(e)}`);
    }
  }

  // Акуратний розділювач між відповідями, як у прикладах
  const sep = "\n— — —\n";
  return parts.join(sep).replace(/\n{3,}/g, "\n\n").trim();
}

/* ------------------------------------------------ */

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

      const { chatId, text } = getMessageInfo(update);
      const lang = detectLang(update); // базова мова (для help/ping та ін.)
      const tgLangCode: string | undefined =
        update?.message?.from?.language_code ||
        update?.edited_message?.from?.language_code ||
        update?.callback_query?.from?.language_code ||
        undefined;

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
            await sendHelp(env as any, chatId, lang);
            return json({ ok: true, handled: "help" });
          }

          // /ping
          if (/^\/ping(?:@\w+)?$/i.test(trimmed)) {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          // /ask … — по-рядкова відповідь
          if (/^\/ask(?:@\w+)?\b/i.test(trimmed)) {
            const q = extractArg(trimmed, "ask");
            const question = q || trimmed.replace(/^\/ask(?:@\w+)?\b/i, "").trim();

            if (!question) {
              await tgSendMessage(env as any, chatId, "Будь ласка, додай питання після команди.");
              return json({ ok: true, handled: "ask:empty" });
            }

            const answer = await answerMultiLine(env, question, tgLangCode);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask:multiline" });
          }

          // Fallback: звичайний текст — теж по-рядково
          if (trimmed.length > 0) {
            const answer = await answerMultiLine(env, trimmed, tgLangCode);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask:fallback:multiline" });
          }
        }

        // Якщо сюди дійшли — нічого не зробили (не текст/нема chatId)
        return json({ ok: true, noop: true });
      } catch (e: any) {
        // Не мовчимо: намагаємось повідомити користувача про помилку
        try {
          if (chatId) {
            await tgSendMessage(
              env as any,
              chatId,
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