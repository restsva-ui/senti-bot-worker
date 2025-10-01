// src/ai/gemini.ts
/**
 * Проста обгортка для Gemini: приймає system + user,
 * щоб інструкція мови завжди спрацьовувала.
 */
import type { Env } from "../index";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent";

type GeminiPart = { text: string };
type GeminiContent = { role?: string; parts: GeminiPart[] };

export async function geminiAskText(
  env: Env,
  system: string,
  user: string,
): Promise<string> {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is missing");

  const body = {
    // Важливо: системну інструкцію передаємо окремо
    systemInstruction: { parts: [{ text: system }] },
    contents: [
      // user-повідомлення окремим об’єктом
      { role: "user", parts: [{ text: user }] } as GeminiContent,
    ],
  };

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini error ${res.status}: ${txt}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    data?.candidates?.[0]?.content?.parts?.map((p: GeminiPart) => p.text).join("\n") ??
    "";
  return String(text || "").trim() || "(empty response)";
}