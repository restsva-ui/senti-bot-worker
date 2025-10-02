// src/services/replier.ts
import { composeSystemInstruction, type Lang } from "../utils/i18n";

/** Що очікує модуль у середовищі */
export interface ReplierEnv {
  // Ключі провайдерів (будь-який може бути відсутнім)
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  // KV кеш для безкоштовних (і швидких) відповідей
  SENTI_CACHE?: KVNamespace;
}

/* ===== Допоміжне ===== */

/** Нормалізує короткий текст: нижній регістр + прибирає просту пунктуацію з країв. */
function norm(s: string): string {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/^[\s.,!?()[\]{}"'«»„“”‘’`~]+|[\s.,!?()[\]{}"'«»„“”‘’`~]+$/g, "");
}

/* ===== Швидкі відповіді (без звернення до LLM) =====
   ВАЖЛИВО: кожен пакет містить ТІЛЬКИ слова цієї мови.
*/
const QUICK_PACKS: Record<Lang, Record<string, string>> = {
  uk: {
    "так": "Так, чудово! 💪",
    "ні": "Гаразд, прийнято. 🙂",
    "привіт": "Привіт! 👋 Як справи?",
    "дякую": "Будь ласка! 😉",
    "ок": "Окей! 🙂",
    "окей": "Окей! 🙂",
    "гаразд": "Гаразд! 🙂",
    "вітаю": "Вітаю! 👋",
  },
  ru: {
    "да": "Да, супер! 💪",
    "нет": "Окей, принял. 🙂",
    "привет": "Привет! 👋 Как дела?",
    "спасибо": "Пожалуйста! 😉",
    "ок": "Окей! 🙂",
    "окей": "Окей! 🙂",
    "хорошо": "Хорошо! 🙂",
  },
  de: {
    "ja": "Alles klar! 🙂",
    "nein": "Verstanden. 🙂",
    "hallo": "Hallo! 👋 Wie geht’s?",
    "danke": "Gerne! 😉",
    "ok": "Okay! 🙂",
    "okay": "Okay! 🙂",
    "servus": "Servus! 👋",
    "moin": "Moin! 👋",
  },
  en: {
    "yes": "Great! 👍",
    "no": "Okay, noted. 🙂",
    "hi": "Hi there! 👋",
    "hello": "Hey there! 👋",
    "thanks": "You’re welcome! 😉",
    "thank you": "You’re welcome! 😉",
    "ok": "Okay! 🙂",
    "okay": "Okay! 🙂",
  },
};

/** Маленький шаблонізатор для дуже коротких реплік (без звернень до LLM) */
export function quickTemplateReply(lang: Lang, raw: string): string | null {
  const key = norm(raw);
  if (!key) return null;

  const pack = QUICK_PACKS[lang];
  if (!pack) return null;

  // Пряме співпадіння
  if (pack[key]) return pack[key];

  // Якщо ввели "ок!" чи "Привіт:)" — ще раз чистимо краї
  const words = key.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    const w = words[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (pack[w]) return pack[w];
  } else if (words.length === 2) {
    // спецкейс: en "thank you"
    const joined = words.join(" ");
    if (pack[joined]) return pack[joined];
  }

  return null;
}

/* ===== LLM-провайдери ===== */

/** Проста обгортка для Gemini */
async function askGemini(env: ReplierEnv, prompt: string, lang: Lang): Promise<string> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini key missing");

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    key,
  )}`;

  const system = composeSystemInstruction(lang);
  const reinforced = `${system}\n\n${prompt}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: reinforced }] }],
    // ВАЖЛИВО: саме camelCase поле
    systemInstruction: { parts: [{ text: system }] },
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

/* ===== KV-кеш ключ ===== */
function kvKey(lang: Lang, q: string) {
  return `tpl:${lang}:${q.trim().toLowerCase()}`;
}

/* Тимчасові/квотні помилки Gemini, при яких треба робити фолбек на OpenRouter */
const TRANSIENT_ERR = /(quota|rate[-\s]?limit|exceed|overload|overloaded|model is overloaded|busy|unavailable|temporar|try again later|timeout|timed out|429|500|503)/i;

/* ===== Основний роутер =====
   1) KV-кеш коротких реплік → миттєва відповідь
   2) Gemini (якщо є ключ). Якщо ліміт/перевантаження — фолбек на OpenRouter.
   3) OpenRouter (якщо є ключ)
*/
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
      const isTransient = TRANSIENT_ERR.test(msg);
      if (!isTransient || !availOR) {
        // якщо немає OR або помилка не тимчасова — кидаємо далі, хай індекс повідомить користувача
        throw e;
      }
      // інакше — фолбек на OR нижче
    }
  }

  if (availOR) {
    const text = await askOpenRouter(env, trimmed, lang);
    return { text, from: "openrouter" };
  }

  // Якщо немає ключів — м’який дефолт локальною мовою
  return {
    text:
      lang === "uk"
        ? "Зараз зовнішній провайдер відповіді недоступний. Спробуй коротшими запитами або пізніше. 🙂"
        : lang === "ru"
        ? "Сейчас внешний провайдер ответа недоступен. Попробуй короче либо позже. 🙂"
        : lang === "de"
        ? "Der externe Antwortdienst ist gerade nicht verfügbar. Versuch es kurz oder später. 🙂"
        : "The external answer provider is currently unavailable. Try shorter prompts or later. 🙂",
    from: "kv",
  };
}