// src/ai/openrouter.ts

/**
 * Простий клієнт до OpenRouter для текстових запитів.
 * Використовує Chat Completions API: https://openrouter.ai/docs
 */

export interface OpenRouterEnv {
  OPENROUTER_API_KEY?: string;
}

type AskOpts = {
  /** Яку модель використати. За замовчуванням — авто-вибір */
  model?: string;
  /** Необов'язковий системний промпт */
  system?: string;
};

export async function openrouterAskText(
  env: OpenRouterEnv,
  prompt: string,
  opts: AskOpts = {},
): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing");
  }

  const model = opts.model || "openrouter/auto";
  const system = opts.system?.trim();

  const body: any = {
    model,
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      { role: "user", content: prompt },
    ],
    // небагато «обережних» параметрів за замовчуванням
    temperature: 0.7,
  };

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const txt = await r.text();
  if (!txt) throw new Error("OpenRouter: empty response");

  let json: any;
  try {
    json = JSON.parse(txt);
  } catch {
    throw new Error("OpenRouter: bad JSON from upstream");
  }

  // Помилка у форматі OpenRouter
  if (!r.ok) {
    const msg = json?.error?.message || r.statusText || "unknown error";
    throw new Error(`OpenRouter HTTP ${r.status}: ${msg}`);
  }

  const content =
    json?.choices?.[0]?.message?.content ||
    json?.choices?.[0]?.delta?.content ||
    "";

  if (!content) {
    throw new Error("OpenRouter: no content in response");
  }

  return String(content).trim();
}