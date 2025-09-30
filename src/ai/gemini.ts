// src/ai/gemini.ts

export interface GeminiEnv {
  GEMINI_API_KEY?: string;
}

/**
 * Витягує текст з відповіді Gemini (candidates → content.parts[].text).
 */
function extractText(resp: any): string {
  const parts =
    resp?.candidates?.[0]?.content?.parts ??
    resp?.candidates?.[0]?.content?.parts ??
    [];

  const texts: string[] = [];
  for (const p of parts) {
    if (typeof p?.text === "string") texts.push(p.text);
  }
  return texts.join("\n").trim();
}

/**
 * Простий генератор тексту через Gemini 2.5 Flash.
 * Повертає згенерований текст або кидає помилку з читабельним повідомленням.
 */
export async function geminiGenerateText(
  env: GeminiEnv,
  prompt: string,
  opts?: {
    model?: string; // якщо треба інша модель
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
  },
): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }

  const model = opts?.model ?? "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: opts?.temperature ?? 0.7,
      topP: opts?.topP ?? 0.95,
      maxOutputTokens: opts?.maxOutputTokens ?? 1024,
    },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await r.text();
  if (!r.ok) {
    // Спробуємо дістати повідомлення про помилку з JSON
    try {
      const j = JSON.parse(text);
      const msg =
        j?.error?.message ||
        j?.error?.status ||
        `HTTP ${r.status} ${r.statusText}`;
      throw new Error(`Gemini error: ${msg}`);
    } catch {
      throw new Error(`Gemini error: HTTP ${r.status} ${r.statusText}`);
    }
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Gemini error: bad JSON from upstream");
  }

  const out = extractText(json);
  if (!out) {
    throw new Error("Gemini error: empty response");
  }
  return out;
}