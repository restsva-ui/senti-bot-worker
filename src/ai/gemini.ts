// src/ai/gemini.ts

/**
 * Клієнт до Gemini API (Google Generative Language).
 * Використовує GEMINI_API_KEY з секретів воркера.
 */

export interface Env {
  GEMINI_API_KEY?: string;
}

export type GeminiTextModel =
  | "gemini-2.5-flash"
  | "gemini-2.0-flash-001"
  | "gemini-pro-latest";

const DEFAULT_MODEL: GeminiTextModel = "gemini-2.5-flash";

export type AskOptions = {
  model?: GeminiTextModel;
  system?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
};

/**
 * Основна функція: надсилає текстовий prompt у Gemini і повертає відповідь.
 */
export async function geminiAskText(
  env: Env,
  prompt: string,
  opts: AskOptions = {},
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const model = opts.model ?? DEFAULT_MODEL;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  const body: any = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      topP: opts.topP ?? 0.95,
      maxOutputTokens: opts.maxOutputTokens ?? 512,
    },
  };

  if (opts.system) {
    body.systemInstruction = {
      role: "system",
      parts: [{ text: opts.system }],
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${text || "no body"}`);
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Gemini: bad JSON response");
  }

  const candidate = json?.candidates?.[0];
  const parts: Array<{ text?: string }> = candidate?.content?.parts ?? [];
  const out = parts.map((p) => p?.text ?? "").join("").trim();

  if (!out) {
    throw new Error("Gemini: empty result");
  }

  return out;
}