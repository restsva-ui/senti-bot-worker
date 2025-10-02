import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { handleDiagnostics } from "./diagnostics-ai";
import { normalizeLang, languageInstruction, type Lang } from "./utils/i18n";

/* ===== типи середовища ===== */
export interface Env {
  // Telegram
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  // AI keys
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  // CF flags (не використовуємо тут напряму)
  CF_VISION?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

/* ===== утиліти ===== */
function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Делікатне визначення мови з Telegram update */
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

/** Виділяє аргумент після команди (/ask …) */
function extractArg(text: string, command: string): string {
  const noBot = text.replace(new RegExp(`^\\/${command}(?:@\\w+)?\\s*`, "i"), "");
  return noBot.trim();
}

/**
 * Розбиває “батч” у межах одного повідомлення.
 * Підтримує формати:
 *  - кілька рядків, де кожен може починатися з /ask
 *  - рядки, розділені порожніми строками
 */
function parseMultiAsk(raw: string): string[] {
  const lines = raw
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\/ask(?:@\w+)?\s*/i, "").trim())
    .filter((l) => l.length > 0);

  return lines.length > 0 ? lines : [raw.trim()];
}

/* ===== звернення до моделей ===== */

/** Gemini */
async function askGemini(env: Env, prompt: string, lang: Lang): Promise<string> {
  if (!env.GEMINI_API_KEY) return "Gemini: API-ключ відсутній у воркері.";

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  const systemInstrText = languageInstruction(lang);
  const reinforcedPrompt = `${systemInstrText}\n\n${prompt}`;

  const body = {
    systemInstruction: { parts: [{ text: systemInstrText }] },
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

/** OpenRouter */
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

/** Дістаємо chatId і текст для різних типів апдейтів */
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

/* ===== воркер ===== */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // healthcheck
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "senti-bot-worker", ts: Date.now() });
    }

    // diagnostics (AI)
    const diag = await handleDiagnostics(request, env as any, url);
    if (diag) return diag;

    // Telegram webhook
    if (request.method === "POST" && url.pathname === "/webhook") {
      // секрет (за наявності)
      const expected = (env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "").trim();
      if (expected) {
        const got = (request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
        if (got !== expected) return json({ ok: false, error: "invalid secret" }, 403);
      }

      // апдейт
      let update: any = null;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "bad json" }, 400);
      }

      const { chatId, text } = getMessageInfo(update);
      const msgLang = detectLang(update); // мова всього повідомлення (на випадок одиночного рядка)

      try {
        // callback
        if (update?.callback_query?.id && chatId) {
          await tgSendMessage(env as any, chatId, `tap: ${update?.callback_query?.data ?? ""}`);
          return json({ ok: true, handled: "callback" });
        }

        if (typeof text === "string" && chatId) {
          // /start | /help
          if (/^\/start(?:@\w+)?$/i.test(text) || /^\/help(?:@\w+)?$/i.test(text)) {
            await sendHelp(env as any, chatId, msgLang);
            return json({ ok: true, handled: "help" });
          }

          // /ping
          if (/^\/ping(?:@\w+)?$/i.test(text)) {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          // /ask_openrouter — може бути батч
          if (/^\/ask_openrouter(?:@\w+)?\b/i.test(text)) {
            const qRaw = extractArg(text, "ask_openrouter");
            const items = parseMultiAsk(qRaw);

            if (items.length === 0) {
              await tgSendMessage(env as any, chatId, "Будь ласка, додай питання після команди.");
              return json({ ok: true, handled: "ask_openrouter:empty" });
            }

            const answers: string[] = [];
            for (const item of items) {
              const localLang = normalizeLang(item, update?.message?.from?.language_code);
              const ans = await askOpenRouter(env, item, localLang);
              answers.push(ans.trim());
            }

            await tgSendMessage(env as any, chatId, answers.join("\n\n"));
            return json({ ok: true, handled: "ask_openrouter:batch" });
          }

          // /ask (Gemini) — також батч
          if (/^\/ask(?:@\w+)?\b/i.test(text)) {
            const qRaw = extractArg(text, "ask");
            const items = parseMultiAsk(qRaw);

            if (items.length === 0) {
              await tgSendMessage(env as any, chatId, "Будь ласка, додай питання після команди.");
              return json({ ok: true, handled: "ask:empty" });
            }

            const answers: string[] = [];
            for (const item of items) {
              const localLang = normalizeLang(item, update?.message?.from?.language_code);
              const ans = await askGemini(env, item, localLang);
              answers.push(ans.trim());
            }

            await tgSendMessage(env as any, chatId, answers.join("\n\n"));
            return json({ ok: true, handled: "ask:batch" });
          }

          // звичайний текст → як /ask (Gemini), одиночний
          const plain = text.trim();
          if (plain.length > 0) {
            const answer = await askGemini(env, plain, msgLang);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask:fallback" });
          }
        }

        return json({ ok: true, noop: true });
      } catch (e: any) {
        try {
          if (chatId) {
            await tgSendMessage(
              env as any,
              chatId,
              `Вибач, сталася внутрішня помилка: ${e?.message || String(e)}`
            );
          }
        } catch { /* ignore */ }
        return json({ ok: false, error: "internal" }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};