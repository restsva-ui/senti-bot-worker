// src/diagnostics-ai.ts
// Діагностичні ендпоїнти для AI-провайдерів.
// ВАЖЛИВО: ця функція викликається з /diagnostics, а тут ми
// матчимо ШЛЯХИ, що починаються з /ai/... (тобто без /diagnostics).

import { ok, err } from "./ai/providers";
import { aiTextRouter, cfVision, geminiListModels } from "./ai/providers";

type Env = {
  AI_PROVIDER?: "gemini" | "openrouter" | "cf-vision";
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
};

// ---- OpenRouter: список моделей -------------------------------------------
async function openrouterListModels(env: Env): Promise<Response> {
  if (!env.OPENROUTER_API_KEY) {
    return err("OpenRouter error: OPENROUTER_API_KEY is missing", 500);
  }
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
        "Accept": "application/json",
      },
    });
    const txt = await r.text();
    if (!txt) return err("OpenRouter error: empty response", 502);

    let json: unknown;
    try {
      json = JSON.parse(txt);
    } catch {
      return err("OpenRouter error: bad JSON from upstream", 502);
    }
    return ok({ provider: "openrouter", raw: json });
  } catch (e: any) {
    return err(`OpenRouter error: ${e?.message || String(e)}`, 500);
  }
}

// ---- Gemini: простий текстовий тест ----------------------------------------
async function geminiTextEcho(env: Env, q: string): Promise<Response> {
  if (!env.GEMINI_API_KEY) {
    return err("Gemini error: GEMINI_API_KEY is missing", 500);
  }
  try {
    // Легкий ехо-запит до Gemini 2.0 Flash 001 (офіційний REST)
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `gemini-2.0-flash-001:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

    const body = {
      contents: [{ parts: [{ text: `echo: ${q || "ping"}` }] }],
      generationConfig: { temperature: 0.2 },
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const txt = await r.text();
    if (!txt) return err("Gemini error: empty response", 502);

    let json: any;
    try {
      json = JSON.parse(txt);
    } catch {
      return err("Gemini error: bad JSON from upstream", 502);
    }

    return ok({
      provider: "gemini",
      raw: {
        success: r.ok,
        status: r.status,
        result:
          json?.candidates?.[0]?.content?.parts?.[0]?.text ??
          json?.candidates ?? null,
        error: r.ok ? [] : [{ code: r.status, message: json?.error?.message || "HTTP " + r.status }],
      },
    });
  } catch (e: any) {
    return err(`Gemini error: ${e?.message || String(e)}`, 500);
  }
}

// ---- Роутер усередині /diagnostics ----------------------------------------
type Handler = (env: Env, req: Request, url: URL) => Promise<Response>;
const HANDLERS: Record<string, Handler> = {
  // Який провайдер зараз активний згідно ENV
  "/ai/provider": (env) => aiTextRouter(env),

  // Перелік моделей Gemini
  "/ai/gemini/models": (env) => geminiListModels(env),

  // Перевірка наявності CF Vision (прапорець CF_VISION)
  "/ai/cf-vision": (env) => cfVision(env),

  // Проста перевірка тексту в Gemini
  "/ai/gemini/text": (env, _req, url) =>
    geminiTextEcho(env, url.searchParams.get("q") || "ping"),

  // Перелік моделей через OpenRouter
  "/ai/openrouter/models": (env) => openrouterListModels(env),
};

export async function handleAIDiagnostics(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  // Працюємо лише з префіксом /ai/ усередині /diagnostics
  if (!url.pathname.startsWith("/ai/")) return null;

  const pathOnly = url.pathname; // вже вигляду /ai/...
  const handler = HANDLERS[pathOnly];
  if (!handler) {
    return new Response(JSON.stringify({ ok: false, error: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  return handler(env, request, url);
}