// src/ai/providers.ts

export interface Env {
  CF_VISION: string;                 // базовий URL до Cloudflare AI Gateway або /ai/run
  CLOUDFLARE_API_TOKEN?: string;     // для /ai/token/verify (не обов'язково для Vision)
  GEMINI_API_KEY?: string;           // Google Generative Language API key
  OPENROUTER_API_KEY?: string;       // OpenRouter key (для DeepSeek та ін.)
}

export function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, status, data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function err(error: unknown, status = 400) {
  const message =
    typeof error === "string"
      ? error
      : (error as any)?.message || (error as any) || "error";
  return new Response(
    JSON.stringify({ ok: false, status, error: String(message) }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  );
}

/**
 * CF Vision (images -> text). Проксі на твій CF AI Gateway або /ai/run.
 * Очікує model у шляху всередині CF_VISION, наприклад:
 *   https://api.cloudflare.com/client/v4/accounts/<acc>/ai/run/@cf/meta/llama-3.2-11b-vision-instruct
 */
export async function runCfVision(env: Env, imageUrl: string, prompt = "") {
  const body = {
    prompt: prompt || "Опиши зображення двома словами.",
    image_url: imageUrl,
  };

  const r = await fetch(env.CF_VISION, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // якщо CF_VISION — це твій Gateway route, токен не потрібен
      ...(env.CLOUDFLARE_API_TOKEN
        ? { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(body),
  });

  const raw = await r.json().catch(() => ({}));
  if (!r.ok || (raw && raw.success === false)) {
    throw new Error(
      `CF Vision ${r.status}: ${JSON.stringify(raw?.errors || raw)}`
    );
  }

  // CF AI повертає різні структури. Нормалізуємо у text.
  const text =
    raw?.result?.response ||
    raw?.result?.text ||
    raw?.response ||
    raw?.text ||
    JSON.stringify(raw);

  return { provider: "cf-vision", text, raw };
}

/**
 * Google Gemini (text). Працює з v1beta generateContent
 * Модель передається параметром; якщо не задано — пробуємо '-latest' варіант.
 */
export async function runGemini(
  env: Env,
  prompt: string,
  model = "gemini-1.5-flash-latest"
) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
  };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await r.json().catch(() => ({}));
  if (!r.ok || raw?.error) {
    throw new Error(
      `Gemini ${r.status}: ${JSON.stringify(raw?.error || raw)}`
    );
  }

  const text =
    raw?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text)?.join("") ??
    raw?.output_text ??
    JSON.stringify(raw);

  return { provider: "gemini", model, text, raw };
}

/**
 * Список моделей Gemini: GET v1beta/models
 */
export async function geminiListModels(env: Env) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
    env.GEMINI_API_KEY
  )}`;

  const r = await fetch(endpoint, { headers: { accept: "application/json" } });
  const raw = await r.json().catch(() => ({}));
  if (!r.ok || raw?.error) {
    throw new Error(
      `Gemini listModels ${r.status}: ${JSON.stringify(raw?.error || raw)}`
    );
  }

  // Тільки ті, що підтримують generateContent
  const models =
    raw?.models?.filter((m: any) =>
      (m?.supportedGenerationMethods || []).includes("generateContent")
    ) || raw?.models || [];

  return { provider: "gemini", models, raw };
}

/**
 * OpenRouter: зручно тестувати безкоштовні/дешеві моделі (DeepSeek тощо).
 */
export async function runOpenRouter(
  env: Env,
  prompt: string,
  model = "deepseek/deepseek-chat"
) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing");

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "http-referer": "https://workers.dev",
      "x-title": "senti-bot-worker",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const raw = await r.json().catch(() => ({}));
  if (!r.ok || raw?.error) {
    throw new Error(
      `OpenRouter ${r.status}: ${JSON.stringify(raw?.error || raw)}`
    );
  }

  const text =
    raw?.choices?.[0]?.message?.content ??
    raw?.output_text ??
    JSON.stringify(raw);

  return { provider: "openrouter", model, text, raw };
}