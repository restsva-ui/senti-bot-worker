// src/ai/gemini.ts

/**
 * Мінімальний клієнт до Gemini (Google Generative Language API).
 * Потрібен лише GEMINI_API_KEY у секретах воркера.
 *
 * Приклад використання:
 *   const text = await geminiAskText(env, "Привіт! Хто ти?");
 */

export interface Env {
  GEMINI_API_KEY?: string;
}

/** Моделі, які стабільно є в v1beta */
export type GeminiTextModel =
  | "gemini-2.5-flash"
  | "gemini-2.0-flash-001"
  | "gemini-pro-latest";

const DEFAULT_MODEL: GeminiTextModel = "gemini-2.5-flash";

/** Опції генерації (усі — необов’язкові) */
export type AskOptions = {
  model?: GeminiTextModel;
  system?: string; // system prompt
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
};

/**
 * Викликає Gemini і повертає згенерований текст (перший кандидат).
 * Кидає помилку, якщо щось пішло не так.
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

  // Тіло запиту згідно v1beta
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
    // systemInstruction підтримується у v1beta
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
    // Повертаємо зміст відповіді для швидкої діагностики
    throw new Error(
      `Gemini HTTP ${res.status}: ${text || "no body returned"}`,
    );
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Gemini: bad JSON in response");
  }

  // Очікувана форма: { candidates: [ { content: { parts: [ {text} ] } } ] }
  const candidate = json?.candidates?.[0];
  const parts: Array<{ text?: string }> = candidate?.content?.parts ?? [];

  const out = parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("")
    .trim();

  if (!out) {
    // Іноді помилка при success=true, але без тексту
    const errMsg =
      candidate?.finishReason ||
      json?.error?.message ||
      "empty result from Gemini";
    throw new Error(`Gemini: ${errMsg}`);
  }

  return out;
}