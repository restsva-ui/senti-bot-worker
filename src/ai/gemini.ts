// src/ai/gemini.ts

import { languageInstruction, type Lang } from "../utils/i18n";

export interface Env {
  GEMINI_API_KEY?: string;
}

/**
 * Легасі-fallback, якщо зверху явно не передали lang.
 * Лишаємо для сумісності з потенційними старими викликами.
 */
function legacyDetectLang(prompt: string): "uk" | "ru" | "en" {
  const hasUk = /[іІїЇєЄґҐ]/.test(prompt);
  const hasCyr = /[а-яА-ЯёЁ]/.test(prompt);
  if (hasUk) return "uk";
  if (hasCyr) return "ru";
  return "en";
}

/** Дружній стиль для кожної мови (коротко й по-людськи). */
function styleInstruction(lang: Lang): string {
  switch (lang) {
    case "uk":
      return (
        "Пиши природно й по-людськи: короткі речення, дружній тон, без канцеляризмів. " +
        "Не згадуй, що ти ШІ. Якщо просять список — дай маркери."
      );
    case "ru":
      return (
        "Пиши естественно и дружелюбно: короткие фразы, простой разговорный тон, без канцеляризмов. " +
        "Не упоминай, что ты ИИ. Если просят список — используй маркеры."
      );
    case "de":
      return (
        "Schreibe natürlich und freundlich: kurze Sätze, lockerer Ton, ohne Amtsdeutsch. " +
        "Erwähne nicht, dass du eine KI bist. Bei Listen nutze Aufzählungen."
      );
    case "en":
    default:
      return (
        "Write naturally and friendly: short sentences, conversational tone, no corporate jargon. " +
        "Do not say you are an AI. Use bullet points for lists."
      );
  }
}

/** Прибираємо зайві преамбули типу “I’m an AI…”, “Как ИИ…” тощо. */
function sanitizeAnswer(text: string, lang: Lang): string {
  const lines = text.split(/\r?\n/);

  const patterns: RegExp[] = [
    // EN
    /^\s*i['’]m an ai.*$/i,
    /^\s*as an ai.*$/i,
    // RU
    /^\s*я\s+являюсь\s+искусственным\s+интеллектом.*$/i,
    /^\s*как\s+ии[, ]/i,
    /^\s*как\s+искусственный\s+интеллект[, ]/i,
    // UK
    /^\s*я\s+штучний\s+інтелект.*$/i,
    /^\s*як\s+штучний\s+інтелект[, ]/i,
    // DE
    /^\s*als\s+ki[, ]/i,
    /^\s*ich\s+bin\s+eine\s+ki.*$/i,
  ];

  const filtered = lines.filter((l) => !patterns.some((re) => re.test(l)));
  // Прибираємо зайві порожні рядки на початку/в кінці
  return filtered.join("\n").trim().replace(/\n{3,}/g, "\n\n");
}

/**
 * Виклик Gemini для текстової відповіді.
 * - Використовуємо правильне поле `systemInstruction` (camelCase).
 * - Якщо lang передано — це джерело істини; інакше — fallback.
 * - Додаємо коротку мовну підказку на початок prompt як страховку.
 * - Стилизуємо тон як дружній/розмовний.
 */
export async function geminiAskText(
  env: Env,
  prompt: string,
  lang?: Lang,
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  const targetLang: Lang = (lang ?? (legacyDetectLang(prompt) as Lang)) as Lang;

  // Комбінована інструкція: мова + стиль
  const systemInstr = `${languageInstruction(targetLang)}\n${styleInstruction(
    targetLang,
  )}`;

  // Страховка: дублюємо дуже коротку інструкцію на початку промпта
  const reinforcedPrompt = `${systemInstr}\n\n${prompt}`;

  const body: any = {
    contents: [
      {
        role: "user",
        parts: [{ text: reinforcedPrompt }],
      },
    ],
    // ВАЖЛИВО: саме `systemInstruction` (camelCase), без role
    systemInstruction: {
      parts: [{ text: systemInstr }],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });

  // Може повернутись не-JSON при помилці проксі/мережі
  const raw = await res.text();
  let json: any = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `Gemini: bad JSON from upstream${
        raw ? ` — ${raw.slice(0, 160)}` : ""
      }`,
    );
  }

  if (!res.ok) {
    const err = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(`Gemini error: ${err}`);
  }

  // Якщо відповідь заблокована політиками
  const block = json?.promptFeedback?.blockReason;
  if (block) {
    throw new Error(`Gemini blocked: ${block}`);
  }

  // Витягуємо текст з усіх parts усіх кандидатів
  const texts: string[] = [];
  const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
  for (const c of candidates) {
    const parts = c?.content?.parts || [];
    for (const p of parts) {
      if (typeof p?.text === "string" && p.text.trim()) {
        texts.push(p.text);
      }
    }
  }

  const answer = texts.join("\n").trim();
  if (!answer) {
    throw new Error("Gemini returned no text");
  }

  // Фінальний санітизатор і легка зачистка форматування
  return sanitizeAnswer(answer, targetLang);
}