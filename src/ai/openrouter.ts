// src/ai/openrouter.ts

export interface Env {
  OPENROUTER_API_KEY?: string;
}

/**
 * Запит через OpenRouter. За замовчуванням ставимо "openrouter/auto",
 * щоб провайдер сам підбирав модель (стабільно і без прив’язки до конкретної).
 */
export async function openrouterAskText(
  env: Env,
  prompt: string,
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing");
  }

  const url = "https://openrouter.ai/api/v1/chat/completions";

  const body = {
    model: "openrouter/auto",
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: prompt },
    ],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      // опціональні, але корисні для OpenRouter
      "HTTP-Referer": "https://github.com/restsva/senti-bot-worker",
      "X-Title": "Senti Bot",
    },
    body: JSON.stringify(body),
  });

  const txt = await r.text();
  if (!txt) throw new Error("OpenRouter empty response");

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error("OpenRouter bad JSON");
  }

  const content: string | undefined = json?.choices?.[0]?.message?.content;
  if (!content) {
    const err =
      json?.error?.message || json?.message || "OpenRouter returned no text";
    throw new Error(err);
  }
  return content;
}