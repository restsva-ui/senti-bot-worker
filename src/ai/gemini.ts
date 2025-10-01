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

/**
 * Виклик Gemini для текстової відповіді.
 * - Використовуємо правильне поле `systemInstruction` (camelCase).
 * - Якщо lang передано — це джерело істини; інакше — fallback.
 * - Додаємо коротку мовну підказку на початок prompt як страховку.
 */
export async function geminiAskText(
  env: Env,
  prompt: string,
  lang?: Lang,
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  // Стабільна швидка модель із діагностик: доступна у тебе
  const model = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  const targetLang: Lang = lang ?? (legacyDetectLang(prompt) as Lang);
  const systemInstr = languageInstruction(targetLang);

  // Страховка: дублюємо дуже коротку інструкцію на початку промпта,
  // на випадок якщо API проігнорує systemInstruction.
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
    throw new Error(`Gemini: bad JSON from upstream${raw ? ` — ${raw.slice(0, 160)}` : ""}`);
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

  return answer;
}