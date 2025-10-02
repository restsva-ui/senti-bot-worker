// src/services/replier.ts
import { composeSystemInstruction, type Lang } from "../utils/i18n";

/** Що очікує модуль у середовищі */
export interface ReplierEnv {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  SENTI_CACHE?: KVNamespace;
}

/** Маленький шаблонізатор для дуже коротких реплік (без звернень до LLM) */
export function quickTemplateReply(lang: Lang, raw: string): string | null {
  const t = (raw || "").trim().toLowerCase();

  // Усі відповіді — мовою `lang`, навіть якщо тригер іншою мовою.
  const packs: Record<Lang, Record<string, string>> = {
    uk: {
      // українські тригери
      "так": "Так, чудово! 💪",
      "ні": "Гаразд, прийнято. 🙂",
      "привіт": "Привіт! 👋 Як справи?",
      "ок": "Окей! 🙂",
      "дякую": "Будь ласка! 😉",
      // інші мови як тригери → українська відповідь
      "hi": "Привіт! 👋 Як справи?",
      "hello": "Привіт! 👋 Як справи?",
      "yes": "Так, чудово! 💪",
      "no": "Гаразд, прийнято. 🙂",
      "ja": "Гаразд, зрозуміло. 🙂",
      "nein": "Зрозуміло. 🙂",
      "да": "Так, чудово! 💪",
      "нет": "Гаразд, прийнято. 🙂",
    },
    ru: {
      "да": "Да, супер! 💪",
      "нет": "Окей, принял. 🙂",
      "привет": "Привет! 👋 Как дела?",
      "ок": "Окей! 🙂",
      "окей": "Окей! 🙂",
      // иностранные триггеры → ответ по-русски
      "hi": "Привет! 👋 Как дела?",
      "hello": "Привет! 👋 Как дела?",
      "yes": "Да, супер! 💪",
      "no": "Окей, принял. 🙂",
      "ja": "Понял. 🙂",
      "nein": "Понял. 🙂",
      "так": "Да, супер! 💪",
      "ні": "Окей, принял. 🙂",
    },
    de: {
      "ja": "Alles klar! 🙂",
      "nein": "Verstanden. 🙂",
      "hallo": "Hallo! 👋 Wie geht’s?",
      "ok": "Okay! 🙂",
      "okay": "Okay! 🙂",
      // fremde Trigger → deutsche Antwort
      "hi": "Hallo! 👋 Wie geht’s?",
      "hello": "Hallo! 👋 Wie geht’s?",
      "yes": "Alles klar! 🙂",
      "no": "Verstanden. 🙂",
      "да": "Alles klar! 🙂",
      "нет": "Verstanden. 🙂",
      "так": "Alles klar! 🙂",
      "ні": "Verstanden. 🙂",
    },
    en: {
      "yes": "Great! 👍",
      "no": "Okay, noted. 🙂",
      "hi": "Hi there! 👋",
      "hello": "Hey there! 👋",
      "ok": "Okay! 🙂",
      "okay": "Okay! 🙂",
      // foreign triggers → English reply
      "привіт": "Hi there! 👋",
      "да": "Great! 👍",
      "нет": "Okay, noted. 🙂",
      "ja": "All right! 🙂",
      "nein": "Got it. 🙂",
      "так": "Great! 👍",
      "ні": "Okay, noted. 🙂",
    },
  };

  const m = packs[lang]?.[t];
  return m || null;
}

/** Проста обгортка для Gemini */
async function askGemini(env: ReplierEnv, prompt: string, lang: Lang): Promise<string> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini key missing");

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;

  const system = composeSystemInstruction(lang);
  const reinforced = `${system}\n\n${prompt}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: reinforced }] }],
    systemInstruction: { parts: [{ text: system }] }, // camelCase обов’язково
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });

  const raw = await r.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }

  if (!r.ok) {
    const msg = data?.error?.message || raw || `HTTP ${r.status}`;
    throw new Error(`Gemini: ${msg}`);
  }

  const parts: string[] =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      ?.filter(Boolean) ?? [];

  return parts.join("\n").trim() || "(empty)";
}

/** Проста обгортка для OpenRouter */
async function askOpenRouter(env: ReplierEnv, prompt: string, lang: Lang): Promise<string> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OpenRouter key missing");

  const system = composeSystemInstruction(lang);
  const body = {
    model: "openrouter/auto",
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${key}`,
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
    throw new Error(`OpenRouter: ${msg}`);
  }

  const txt =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.map((c: any) => c?.message?.content).filter(Boolean).join("\n") ||
    "";

  return (txt || "").trim() || "(empty)";
}

/** KV-кеш: ключ з урахуванням мови */
function kvKey(lang: Lang, q: string) {
  return `tpl:${lang}:${q.trim().toLowerCase()}`;
}

export async function askSmart(
  env: ReplierEnv,
  prompt: string,
  lang: Lang,
): Promise<{ text: string; from: "kv" | "gemini" | "openrouter" }> {
  const trimmed = prompt.trim();

  // 1) KV як безкоштовний/миттєвий шар
  const cached = await env.SENTI_CACHE?.get(kvKey(lang, trimmed));
  if (cached) return { text: cached, from: "kv" };

  // 2) Провайдери
  const availGemini = !!env.GEMINI_API_KEY;
  const availOR = !!env.OPENROUTER_API_KEY;

  // Спершу Gemini, потім OR (якщо є ключі)
  if (availGemini) {
    try {
      const text = await askGemini(env, trimmed, lang);
      return { text, from: "gemini" };
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      const isQuota = /quota|rate[-\s]?limit|exceeded/i.test(msg);
      if (!isQuota || !availOR) throw e;
    }
  }

  if (availOR) {
    const text = await askOpenRouter(env, trimmed, lang);
    return { text, from: "openrouter" };
  }

  // Якщо немає ключів — м’який дефолт
  return {
    text:
      lang === "uk"
        ? "Зараз недоступний зовнішній провайдер відповіді. Спробуй коротшими запитами або пізніше. 🙂"
        : lang === "ru"
        ? "Сейчас недоступен внешний провайдер ответа. Попробуй короче либо позже. 🙂"
        : lang === "de"
        ? "Der externe Antwortdienst ist gerade nicht verfügbar. Versuch es kurz oder später. 🙂"
        : "The external answer provider is currently unavailable. Try shorter prompts or later. 🙂",
    from: "kv",
  };
}