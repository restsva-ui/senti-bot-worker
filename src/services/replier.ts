// src/services/replier.ts
import type { Lang } from "../utils/i18n";
import { geminiAskText } from "../ai/gemini";
import { openrouterAskText } from "../ai/openrouter";

/** Env, потрібний саме цьому сервісу */
export interface ReplierEnv {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  RESPONSES_KV?: KVNamespace; // optional
}

/** Прості локальні відповіді для коротких реплік, без звернення до API */
const TEMPLATES: Record<
  Lang,
  { patterns: RegExp[]; responses: string[] }
> = {
  uk: {
    patterns: [
      /^\s*(так)\s*$/i,
      /^\s*(ні|не)\s*$/i,
      /^\s*(привіт|хай|здраст(е|уй))\s*$/i,
      /^\s*(ок(?:ей)?|гаразд)\s*$/i,
      /^\s*(дякую|спасибі)\s*$/i,
    ],
    responses: [
      "Так, звісно!",
      "Ні, на жаль.",
      "Привіт! Як справи?",
      "Окей, без проблем.",
      "Дякую! Радо допоможу.",
    ],
  },
  ru: {
    patterns: [
      /^\s*(да)\s*$/i,
      /^\s*(нет)\s*$/i,
      /^\s*(привет|здравствуй|здравствуйте)\s*$/i,
      /^\s*(ок(?:ей)?|хорошо|ладно)\s*$/i,
      /^\s*(спасибо|благодарю)\s*$/i,
    ],
    responses: [
      "Да, конечно!",
      "Нет, к сожалению.",
      "Привет! Как дела?",
      "Окей, без проблем.",
      "Спасибо! Рад помочь.",
    ],
  },
  de: {
    patterns: [
      /^\s*(ja)\s*$/i,
      /^\s*(nein)\s*$/i,
      /^\s*(hallo|hi)\s*$/i,
      /^\s*(ok(?:ay)?|gut)\s*$/i,
      /^\s*(danke)\s*$/i,
    ],
    responses: [
      "Ja, gerne!",
      "Nein, leider nicht.",
      "Hallo! Wie geht's dir?",
      "Okay, kein Problem.",
      "Danke! Gern geschehen.",
    ],
  },
  en: {
    patterns: [
      /^\s*(yes)\s*$/i,
      /^\s*(no)\s*$/i,
      /^\s*(hi|hello|hey)\s*$/i,
      /^\s*(ok(?:ay)?|fine)\s*$/i,
      /^\s*(thanks|thank you)\s*$/i,
    ],
    responses: [
      "Yes, sure!",
      "No, unfortunately not.",
      "Hi there! How can I help?",
      "Okay, no problem.",
      "Thanks! Happy to help.",
    ],
  },
};

/** Якщо коротка репліка збігається з шаблоном — повертаємо миттєву відповідь */
export function quickTemplateReply(lang: Lang, text: string): string | null {
  const t = (text || "").trim();
  if (!t || t.length > 12) return null; // обмежимося справді короткими

  const set = TEMPLATES[lang];
  for (let i = 0; i < set.patterns.length; i++) {
    if (set.patterns[i].test(t)) return set.responses[i];
  }
  return null;
}

/** Простий хеш для ключа KV */
function simpleHash(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return "h" + h.toString(36);
}

/** Експоненційний backoff з невеликим джитером */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 2,
): Promise<T> {
  let n = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      n++;
      if (n >= attempts) throw e;
      const wait = Math.pow(2, n) * 200 + Math.random() * 150;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/**
 * Головний роутер відповіді:
 * 1) локальний шаблон;
 * 2) KV-кеш (RESPONSES_KV) з TTL;
 * 3) Gemini з retry;
 * 4) fallback на OpenRouter з retry.
 */
export async function askSmart(
  env: ReplierEnv,
  prompt: string,
  lang: Lang,
  opts?: { cacheTtlSec?: number }
): Promise<{ text: string; source: "template" | "cache" | "gemini" | "openrouter" }> {
  const ttl = Math.max(60, opts?.cacheTtlSec ?? 3600); // за замовчуванням 1 година

  // 1) локальний шаблон
  const templ = quickTemplateReply(lang, prompt);
  if (templ) return { text: templ, source: "template" };

  const keyBase = `${lang}:${prompt}`;
  const key = simpleHash(keyBase);

  // 2) KV-кеш
  if (env.RESPONSES_KV) {
    try {
      const cached = await env.RESPONSES_KV.get(key);
      if (cached) return { text: String(cached), source: "cache" };
    } catch {
      // ігноруємо помилки KV
    }
  }

  // 3) Gemini (primary)
  try {
    const text = await withRetry(() => geminiAskText(env as any, prompt, lang), 2);
    if (env.RESPONSES_KV && text && text.length < 16000) {
      await env.RESPONSES_KV.put(key, text, { expirationTtl: ttl }).catch(() => {});
    }
    return { text, source: "gemini" };
  } catch {
    // 4) OpenRouter (fallback)
    const text = await withRetry(() => openrouterAskText(env as any, prompt, lang), 2);
    if (env.RESPONSES_KV && text && text.length < 16000) {
      await env.RESPONSES_KV.put(key, text, { expirationTtl: ttl }).catch(() => {});
    }
    return { text, source: "openrouter" };
  }
}