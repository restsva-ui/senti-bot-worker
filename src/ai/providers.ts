// src/ai/providers.ts

export type Json = Record<string, unknown>;

export const ok = (data: Json | Json[] = {}) =>
  new Response(JSON.stringify({ ok: true, status: 200, data }, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export const err = (message: string, status = 500) =>
  new Response(
    JSON.stringify({ ok: false, status, error: message }, null, 2),
    { status, headers: { "content-type": "application/json; charset=utf-8" } },
  );

type Env = {
  AI_PROVIDER?: "gemini" | "openrouter" | "cf-vision";
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CF_VISION?: string; // просто наявність секрету як прапорець
  CF_AI_GATEWAY_BASE?: string; // optional proxy base (може бути видалений — тоді підемо напряму)
};

/**
 * Повертає активного провайдера з ENV (для /diagnostics/ai/provider)
 */
export async function aiTextRouter(env: Env): Promise<Response> {
  const provider = env.AI_PROVIDER || "openrouter";
  return ok({ provider });
}

/**
 * /diagnostics/ai/gemini/models
 * Тягне список моделей Gemini напряму або через CF AI Gateway (якщо задано CF_AI_GATEWAY_BASE)
 */
export async function geminiListModels(env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) {
    return err("Gemini error: GEMINI_API_KEY is missing", 500);
  }

  const base =
    (env.CF_AI_GATEWAY_BASE && env.CF_AI_GATEWAY_BASE.replace(/\/+$/, "")) ||
    "https://generativelanguage.googleapis.com";

  const url = `${base}/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    const txt = await r.text();

    if (!txt) return err("Gemini error: Unexpected end of JSON input", 500);

    let json: unknown;
    try {
      json = JSON.parse(txt);
    } catch {
      return err("Gemini error: Bad JSON from upstream", 502);
    }

    return ok({ provider: "gemini", raw: json as Json });
  } catch (e: any) {
    return err(`Gemini error: ${e?.message || String(e)}`, 500);
  }
}

/**
 * /diagnostics/ai/gemini/text
 * Проста генерація тексту через Gemini (generateContent).
 * Параметри:
 *   - q (querystring) — промпт
 *   - model (querystring, optional) — наприклад: gemini-2.0-flash-001 або gemini-2.5-flash
 *
 * ВАЖЛИВО: для endpoint'а потрібно ІД без префікса "models/".
 */
export async function geminiText(env: Env, prompt: string, model?: string): Promise<Response> {
  if (!env.GEMINI_API_KEY) {
    return err("Gemini error: GEMINI_API_KEY is missing", 500);
  }

  const base =
    (env.CF_AI_GATEWAY_BASE && env.CF_AI_GATEWAY_BASE.replace(/\/+$/, "")) ||
    "https://generativelanguage.googleapis.com";

  // дефолтна швидка й дешева модель, яка гарантовано є у твоєму списку
  let modelId = (model || "gemini-2.0-flash-001").trim();
  modelId = modelId.replace(/^models\//, ""); // про всяк випадок

  const url = `${base}/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  const body = {
    contents: [
      {
        parts: [{ text: prompt || "Hello from Worker" }],
      },
    ],
    // Можеш додати generationConfig за потреби:
    // generationConfig: { temperature: 0.7, topP: 0.9, maxOutputTokens: 512 }
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    const txt = await r.text();
    if (!txt) {
      return ok({
        provider: "gemini",
        raw: { success: false, error: [{ code: r.status, message: "empty response body" }], result: null },
      });
    }

    let json: any;
    try {
      json = JSON.parse(txt);
    } catch {
      return err("Gemini error: Bad JSON from upstream", 502);
    }

    // Нормалізуємо відповідь (витягуємо plain-текст, якщо є)
    let resultText: string | null = null;
    try {
      resultText =
        json?.candidates?.[0]?.content?.parts
          ?.map((p: any) => (typeof p?.text === "string" ? p.text : ""))
          .join("") || null;
    } catch {
      /* ignore */
    }

    // Якщо Google повернув 404 (неправильна модель), підкажемо користувачу
    if (r.status === 404) {
      return ok({
        provider: "gemini",
        raw: { success: false, error: [{ code: 404, message: "HTTP 404" }], result: null },
      });
    }

    return ok({
      provider: "gemini",
      raw: json,
      result: resultText,
      model: modelId,
      status: r.status,
    });
  } catch (e: any) {
    return err(`Gemini error: ${e?.message || String(e)}`, 500);
  }
}

/**
 * /diagnostics/ai/cf-vision
 * Легка перевірка наявності зв’язки з CF Vision.
 */
export async function cfVision(env: Env): Promise<Response> {
  if (!env.CF_VISION) {
    return err("CF Vision error: CF_VISION secret is missing", 500);
  }
  return ok({ provider: "cf-vision" });
}