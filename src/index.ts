// src/index.ts
import { tgSendMessage } from "./utils/telegram";
import { ping as pingCommand } from "./commands/ping";
import { sendHelp } from "./commands/help";
import { handleDiagnostics } from "./diagnostics-ai";
import { normalizeLang, languageInstruction, type Lang } from "./utils/i18n";

export interface Env {
  // Telegram
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  // AI keys
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  // CF flags (як і було раніше; не використовуємо тут напряму)
  CF_VISION?: string;
  CLOUDFLARE_API_TOKEN?: string;
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Обережне визначення мови з Telegram update */
function detectLang(update: any): Lang {
  const code: string | undefined =
    update?.message?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    undefined;

  // fallback: якщо нема тексту, передаємо порожній рядок
  const text: string =
    update?.message?.text ||
    update?.callback_query?.message?.text ||
    "";

  return normalizeLang(text, code);
}

/** Акуратне виділення тексту після команди */
function extractArg(text: string, command: string): string {
  // приклади: "/ask Привіт", "/ask@YourBot Привіт"
  const noBot = text.replace(new RegExp(`^\\/${command}(?:@\\w+)?\\s*`, "i"), "");
  return noBot.trim();
}

/** Запит до Gemini з урахуванням мови */
async function geminiAskText(env: Env, prompt: string, lang: Lang): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    return "Gemini: API-ключ відсутній у воркері.";
  }

  const endpoint =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

  // ✅ Використовуємо правильну мовну інструкцію з i18n
  const systemInstrText = languageInstruction(lang);

  // Додаткове підсилення: коротко дублюємо інструкцію на початку промпта
  const reinforcedPrompt = `${systemInstrText}\n\n${prompt}`;

  const body = {
    systemInstruction: { parts: [{ text: systemInstrText }] }, // camelCase важливо
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

  if (!r.ok) {
    const errTxt = await r.text().catch(() => "");
    return `Gemini: HTTP ${r.status}${errTxt ? ` — ${errTxt}` : ""}`;
  }

  const data: any = await r.json().catch(() => ({}));
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("\n") ||
    "";

  return text || "Gemini: порожня відповідь.";
}

/** Запит до OpenRouter з урахуванням мови */
async function openrouterAskText(
  env: Env,
  prompt: string,
  lang: Lang,
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    return "OpenRouter: API-ключ відсутній у воркері.";
  }

  const endpoint = "https://openrouter.ai/api/v1/chat/completions";

  // ✅ Та сама узгоджена мовна інструкція
  const systemInstrText = languageInstruction(lang);

  const body = {
    model: "openrouter/auto",
    messages: [
      { role: "system", content: systemInstrText },
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

  if (!r.ok) {
    const errTxt = await r.text().catch(() => "");
    return `OpenRouter: HTTP ${r.status}${errTxt ? ` — ${errTxt}` : ""}`;
  }

  const data: any = await r.json().catch(() => ({}));
  const text =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.map((c: any) => c?.message?.content).filter(Boolean).join("\n") ||
    "";

  return text || "OpenRouter: порожня відповідь.";
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

      const lang = detectLang(update);

      try {
        // /ping /help
        const msg = update?.message;
        const text: string | undefined = msg?.text;
        const chatId = msg?.chat?.id;

        if (typeof text === "string" && chatId) {
          if (/^\/start(?:@\w+)?$/i.test(text) || /^\/help(?:@\w+)?$/i.test(text)) {
            await sendHelp(env as any, chatId, lang);
            return json({ ok: true, handled: "help" });
          }

          if (/^\/ping(?:@\w+)?$/i.test(text)) {
            await pingCommand(env as any, chatId);
            return json({ ok: true, handled: "ping" });
          }

          if (/^\/ask_openrouter(?:@\w+)?\b/i.test(text)) {
            const q = extractArg(text, "ask_openrouter");
            if (!q) {
              await tgSendMessage(env as any, chatId, "Будь ласка, додай питання після команди.");
              return json({ ok: true, handled: "ask_openrouter:empty" });
            }
            const answer = await openrouterAskText(env, q, lang);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask_openrouter" });
          }

          if (/^\/ask(?:@\w+)?\b/i.test(text)) {
            const q = extractArg(text, "ask");
            if (!q) {
              await tgSendMessage(env as any, chatId, "Будь ласка, додай питання після команди.");
              return json({ ok: true, handled: "ask:empty" });
            }
            const answer = await geminiAskText(env, q, lang);
            await tgSendMessage(env as any, chatId, answer);
            return json({ ok: true, handled: "ask" });
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

        return json({ ok: true, noop: true });
      } catch (e: any) {
        console.error("Webhook error:", e?.message || e);
        return json({ ok: false, error: "internal" }, 500);
      }
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};