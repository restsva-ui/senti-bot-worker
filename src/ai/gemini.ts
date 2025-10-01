// src/ai/gemini.ts

import { languageInstruction, type Lang } from "../utils/i18n";

export interface Env {
  GEMINI_API_KEY?: string;
}

/**
 * Історичний fallback-детект, якщо зверху явно не передали lang.
 * Лишаю для сумісності з іншими місцями, де можуть викликати без lang.
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
 * Якщо передано lang — кладемо інструкцію у `systemInstruction`.
 * Якщо lang не передано — зберігаємо стару поведінку (fallback).
 */
export async function geminiAskText(
  env: Env,
  prompt: string,
  lang?: Lang,
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  // 1) Готуємо системну інструкцію (правильне поле: systemInstruction)
  let systemInstr = languageInstruction(
    lang ?? (legacyDetectLang(prompt) as Lang),
  );

  // 2) Додаємо дуже короткий дубль-підказку на початок юзерського тексту.
  //    Якщо API раптом проігнорує systemInstruction, модель все одно
  //    бачить вимогу щодо мови.
  const reinforcedPrompt = `${systemInstr}\n\n${prompt}`;

  const body: any = {
    contents: [
      {
        role: "user",
        parts: [{ text: reinforcedPrompt }],
      },
    ],
    // ВАЖЛИВО: camelCase!
    systemInstruction: {
      parts: [{ text: systemInstr }],
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  // очікуваний формат: candidates[0].content.parts[].text
  const parts: string[] =
    json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      ?.filter((s: string) => s.length > 0) ?? [];

  if (parts.length === 0) {
    const err = json?.promptFeedback?.blockReason || json?.error?.message;
    throw new Error(err || "Gemini returned no text");
  }

  return parts.join("\n");
}