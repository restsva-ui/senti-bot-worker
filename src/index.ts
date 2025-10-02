// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { handleDiagnostics } from "./diagnostics-ai";
import { normalizeLang, type Lang } from "./utils/i18n";

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

/* ------------ helpers: Telegram update ------------ */

function getTelegramLanguageCode(update: any): string | undefined {
  return (
    update?.message?.from?.language_code ||
    update?.edited_message?.from?.language_code ||
    update?.channel_post?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    undefined
  );
}

/** Акуратний детект мови по ВСЬОМУ повідомленню (для нефрагментованих випадків) */
function detectLangWhole(update: any): Lang {
  const code = getTelegramLanguageCode(update);
  const text: string =
    update?.message?.text ||
    update?.edited_message?.text ||
    update?.channel_post?.text ||
    update?.callback_query?.message?.text ||
    "";
  return normalizeLang(text, code);
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

/* ------------ helpers: парсинг команд ------------ */

/** Виділяє аргумент після конкретної команди у рядку */
function extractArg(line: string, command: string): string {
  const noBot = line.replace(
    new RegExp(`^\\/${command}(?:@[A-Za-z0-9_]+)?\\s*`, "i"),
    ""
  );
  return noBot.trim();
}

/** Повертає всі аргументи для /ask (кожен рядок окремо) */
function extractAllArgs(text: string, command: "ask" | "ask_openrouter"): string[] {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const args: string[] = [];
  const re = new RegExp(`^\\/${command}(?:@[A-Za-z0-9_]+)?\\b`, "i");

  for (const line of lines) {
    if (re.test(line)) {
      const q = extractArg(line, command);
      if (q) args.push(q);
    }
  }

  // якщо користувач відправив лише один рядок (усе повідомлення) — теж працює
  if (args.length === 0 && re.test(text)) {
    const q = extractArg(text, command);
    if (q) args.push(q);
  }

  return args;
}

/** Акуратний розділювач між відповідями у батчі */
function joinBatch(parts: string[]): string {
  const sep = "\n— — —\n";
  return parts.filter(Boolean).join(sep);
}

/* ------------ LLM обгортки ------------ */

/** === Gemini (Google) === */
async function askGemini(env: Env, prompt: string, lang: Lang): Promise<string> {
  if (!env.GEMINI_API_KEY) return "Gemini: API-ключ відсутній у воркері.";

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  // Жорстка інструкція: відповідати тільки обраною мовою, без мета-коментарів
  const systemInstrText =
    ((): string => {
      switch (lang) {
        case "uk":
          return "Відповідай ТІЛЬКИ українською. Не коментуй інші мови запиту. Пиши коротко, дружньо, без канцеляризмів.";
        case "ru":
          return "Отвечай ТОЛЬКО по-русски. Не комментируй языки запроса. Коротко и дружелюбно, без канцеляризмов.";
        case "de":
          return "Antworte NUR auf Deutsch. Keine Kommentare zu anderen Sprachen. Kurz, locker, freundlich.";
        case "en":
        default:
          return "Answer ONLY in English. Do not comment on languages. Keep it short, friendly, conversational.";
      }
    })();

  const reinforcedPrompt = `${systemInstrText}\n\n${prompt}`;

  const body = {
    systemInstruction: { parts: [{ text: systemInstrText }] }, // camelCase — важливо
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

  const raw = await r.text();
  let data: any = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    // залишимо "сирий" текст у повідомленні
    return `Gemini: ${raw || "Bad JSON"}`;
  }

  if (!r.ok) {
    const msg = data?.error?.message || raw || `HTTP ${r.status}`;
    return `Gemini: ${msg}`;
  }

  const parts: string[] =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      ?.filter((s: string) => s) ?? [];

  const text = parts.join("\n").trim();
  return text || "Gemini: порожня відповідь.";
}

/** === OpenRouter === */
async function askOpenRouter(env: Env, prompt: string, lang: Lang): Promise<string> {
  if (!env.OPENROUTER_API_KEY) return "OpenRouter: API-ключ відсутній у воркері.";

  const endpoint = "https://openrouter.ai/api/v1/chat/completions";

  const sys =
    ((): string => {
      switch (lang) {
        case "uk":
          return "Відповідай ТІЛЬКИ українською. Не коментуй чи не перекладай інші мови в запиті. Коротко, дружньо.";
        case "ru":
          return "Отвечай ТОЛЬКО по-русски. Не комментируй/не переводь другие языки из запроса. Коротко и дружелюбно.";
        case "de":
          return "Antworte NUR auf Deutsch. Keine Sprach-Kommentare oder Übersetzungen. Kurz, locker.";
        case "en":
        default:
          return "Answer ONLY in English. No language commentary or translation. Short, friendly.";
      }
    })();

  const body = {
    model: "openrouter/auto",
    messages: [
      { role: "system", content: sys },
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
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    return `OpenRouter: ${raw || "Bad JSON"}`;
  }

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

/* ------------ worker ------------ */

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
      // Перевірка секрету
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
      const tgCode = getTelegramLanguageCode(update);
      const wholeLang = detectLangWhole(update);

      try {
        // Callback-кнопки — просто відповімо ехом
        if (update?.callback_query?.id && chatId) {
          await tgSendMessage(env as any, chatId, `tap: ${update?.callback_query?.data ?? ""}`);
          return json({ ok: true, handled: "callback" });
        }

        if (typeof text === "string" && chatId) {
          /* ---------- /start | /help ---------- */
          if (/^\/start(?:@\w+)?$/i.test(text) || /^\/help(?:@\w+)?$/i.test(text)) {
            await sendHelp(env as any, chatId, wholeLang);
            return json({ ok: true, handled: "help" });
          }

          /* ---------- /ping ---------- */
          if (/^\/ping(?:@\w+)?$/i.test(text)) {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          /* ---------- /ask_openrouter (батч) ---------- */
          if (/^\/ask_openrouter(?:@\w+)?\b/i.test(text)) {
            const args = extractAllArgs(text, "ask_openrouter");
            if (args.length === 0) {
              await tgSendMessage(env as any, chatId, "Будь ласка, додай питання після команди.");
              return json({ ok: true, handled: "ask_openrouter:empty" });
            }

            const answers: string[] = [];
            for (const q of args) {
              const l = normalizeLang(q, tgCode);
              const a = await askOpenRouter(env, q, l);
              answers.push(a);
            }
            await tgSendMessage(env as any, chatId, joinBatch(answers));
            return json({ ok: true, handled: "ask_openrouter:batch", count: args.length });
          }

          /* ---------- /ask (Gemini) — батч ---------- */
          if (/^\/ask(?:@\w+)?\b/i.test(text)) {
            const args = extractAllArgs(text, "ask");
            if (args.length === 0) {
              await tgSendMessage(env as any, chatId, "Будь ласка, додай питання після команди.");
              return json({ ok: true, handled: "ask:empty" });
            }

            const answers: string[] = [];
            for (const q of args) {
              const l = normalizeLang(q, tgCode);
              const a = await askGemini(env, q, l);
              answers.push(a);
            }
            await tgSendMessage(env as any, chatId, joinBatch(answers));
            return json({ ok: true, handled: "ask:batch", count: args.length });
          }

          /* ---------- Fallback: звичайний текст — як /ask (Gemini) ---------- */
          const plain = text.trim();
          if (plain.length > 0) {
            const answer = await askGemini(env, plain, wholeLang);
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