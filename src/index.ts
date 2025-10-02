import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { handleDiagnostics } from "./diagnostics-ai";
import { normalizeLang, languageInstruction, type Lang } from "./utils/i18n";

export interface Env {
  // Telegram
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string; // якщо задано — звіряємо
  WEBHOOK_SECRET?: string;        // альтернативне поле

  // AI keys
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  // CF flags (зараз не використовуються тут)
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

/** Виділяє аргумент команди і знімає /<command> з КОЖНОГО рядка. */
function extractArg(text: string, command: string): string {
  // прибираємо префікс з початку всього повідомлення
  const dropFirst = text.replace(
    new RegExp(`^\\/${command}(?:@\\w+)?\\s*`, "i"),
    ""
  );

  // і знімаємо його з кожного подальшого рядка
  const perLine = dropFirst
    .split(/\r?\n/)
    .map((line) =>
      line.replace(new RegExp(`^\\/${command}(?:@\\w+)?\\s*`, "i"), "").trim()
    )
    .filter(Boolean)
    .join("\n");

  return perLine.trim();
}

/** === Gemini === */
async function askGemini(env: Env, prompt: string, lang: Lang): Promise<string> {
  if (!env.GEMINI_API_KEY) return "Gemini: API-ключ відсутній у воркері.";

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  // Жорстка інструкція + страховка у самому промпті
  const systemInstrText = languageInstruction(lang);
  const batchRules =
    "Якщо у вхідному тексті кілька рядків, відповідай на КОЖЕН рядок окремою короткою відповіддю " +
    "у тому ж порядку. Заборонено: будь-які заголовки/преамбули/цитування, фрази «Ось мої відповіді…», " +
    "«Відповідь на …», розділювачі типу --- або ***. Просто дай послідовність відповідей рядок-у-рядок.";
  const reinforcedPrompt = `${systemInstrText}\n${batchRules}\n\n${prompt}`;

  const body = {
    systemInstruction: { parts: [{ text: `${systemInstrText}\n${batchRules}` }] }, // ВАЖЛИВО: camelCase
    contents: [
      {
        role: "user",
        parts: [{ text: reinforcedPrompt }],
      },
    ],
  };

  const url = `${endpoint}?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  // читаємо text спочатку — інколи помилки приходять не-JSON
  const raw = await r.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }

  if (!r.ok) {
    const msg = data?.error?.message || raw || `HTTP ${r.status}`;
    return `Gemini: ${msg}`;
  }

  const parts: string[] =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      ?.filter((s: string) => s) ?? [];

  return parts.join("\n").trim() || "Gemini: порожня відповідь.";
}

/** === OpenRouter === */
async function askOpenRouter(env: Env, prompt: string, lang: Lang): Promise<string> {
  if (!env.OPENROUTER_API_KEY) return "OpenRouter: API-ключ відсутній у воркері.";

  const endpoint = "https://openrouter.ai/api/v1/chat/completions";
  const body = {
    model: "openrouter/auto",
    messages: [
      {
        role: "system",
        content: `You are a helpful assistant. Always answer in ${lang} language. Keep it clear and concise.`,
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://workers.cloudflare.com",
      "X-Title": "Senti Bot",
    },
    body: JSON.stringify(body),
  });

  const raw = await r.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }

  if (!r.ok) {
    const msg = data?.error?.message || raw || `HTTP ${r.status}`;
    return `OpenRouter: ${msg}`;
  }

  const text =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.map((c: any) => c?.message?.content).filter(Boolean).join("\n") ||
    "";

  return (text || "").trim() || "OpenRouter: порожня відповідь.";
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Healthcheck
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // Diagnostics
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
      const lang = detectLang(update);

      try {
        // Callback-кнопки — просто відповімо ехом
        if (update?.callback_query?.id && chatId) {
          await tgSendMessage(env as any, chatId, `tap: ${update?.callback_query?.data ?? ""}`);
          return json({ ok: true, handled: "callback" });
        }

        if (typeof text === "string" && chatId) {
          // /start | /help
          if (/^\/start(?:@\w+)?$/i.test(text) || /^\/help(?:@\w+)?$/i.test(text)) {
            await sendHelp(env as any, chatId, lang);
            return json({ ok: true, handled: "help" });
          }

          // /ping
          if (/^\/ping(?:@\w+)?$/i.test(text)) {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          // /ask_openrouter …
          if (/^\/ask_openrouter(?:@\w+)?\b/i.test(text)) {
            const q = extractArg(text, "ask_openrouter");
            const answer = q
              ? await askOpenRouter(env, q, lang)
              : "Будь ласка, додай питання після команди.";
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask_openrouter" });
          }

          // /ask … (Gemini)
          if (/^\/ask(?:@\w+)?\b/i.test(text)) {
            const q = extractArg(text, "ask");
            const answer = q
              ? await askGemini(env, q, lang)
              : "Будь ласка, додай питання після команди.";
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask" });
          }

          // Fallback: звичайний текст — як /ask (Gemini)
          const plain = text.trim();
          if (plain.length > 0) {
            const answer = await askGemini(env, plain, lang);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask:fallback" });
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