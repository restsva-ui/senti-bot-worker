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
  CF_AI_GATEWAY_BASE?: string; // optional proxy base
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
 * Безпечно тягне список моделей Gemini напряму або через CF AI Gateway (якщо задано CF_AI_GATEWAY_BASE)
 */
export async function geminiListModels(env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) {
    return err("Gemini error: GEMINI_API_KEY is missing", 500);
  }

  // endpoint: офіційний Models API
  const base =
    (env.CF_AI_GATEWAY_BASE && env.CF_AI_GATEWAY_BASE.replace(/\/+$/, "")) ||
    "https://generativelanguage.googleapis.com";
  const url = `${base}/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    const txt = await r.text();

    // іноді gateway повертає порожній body з 200 — відловимо
    if (!txt) return err("Gemini error: Unexpected end of JSON input", 500);

    let json: unknown;
    try {
      json = JSON.parse(txt);
    } catch {
      return err("Gemini error: Bad JSON from upstream", 502);
    }

    // Вирівнюємо у формат, зручний твоїм діагностичним екранам
    return ok({ provider: "gemini", raw: json });
  } catch (e: any) {
    return err(`Gemini error: ${e?.message || String(e)}`, 500);
  }
}

/**
 * /diagnostics/ai/cf-vision
 * Легка перевірка наявності зв’язки з CF Vision.
 * Якщо в ENV є CF_VISION — вважаємо, що інтеграція дозволена.
 * (Минулу помилку “Cannot resolve Cloudflare Account ID” ми не дублюємо тут —
 * ця діагностика просто підтверджує, що у воркері є прапорець/секрет.)
 */
export async function cfVision(env: Env): Promise<Response> {
  if (!env.CF_VISION) {
    return err("CF Vision error: CF_VISION secret is missing", 500);
  }
  return ok({ provider: "cf-vision" });
}

/**
 * /diagnostics/ai/gemini/text
 * Проста перевірка генерації тексту через Gemini
 */
export async function geminiText(env: Env, text: string, modelName?: string) {
  if (!env.GEMINI_API_KEY) {
    return {
      success: false,
      error: [{ code: 401, message: "Missing GEMINI_API_KEY" }],
      result: null,
    };
  }

  const model = modelName || "models/gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text }],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const txt = await res.text();
    let json: any = null;
    try {
      json = txt ? JSON.parse(txt) : null;
    } catch {
      return {
        success: false,
        error: [{ code: 500, message: "Gemini text: invalid JSON from API" }],
        result: null,
      };
    }

    if (!res.ok) {
      const msg =
        (json && (json.error?.message || json.message)) ||
        `HTTP ${res.status}`;
      return {
        success: false,
        error: [{ code: res.status, message: msg }],
        result: null,
      };
    }

    const candidate = json?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const out = parts
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("");

    return {
      success: true,
      error: [],
      result: { text: out, raw: json },
    };
  } catch (err: any) {
    return {
      success: false,
      error: [{ code: 500, message: `Gemini fetch error: ${err?.message || err}` }],
      result: null,
    };
  }
}