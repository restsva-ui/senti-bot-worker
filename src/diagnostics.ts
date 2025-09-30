// src/diagnostics.ts

import {
  ok,
  err,
  aiTextRouter,
  geminiListModels,
  cfVision,
} from "./ai/providers";

export interface Env {
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  AI_PROVIDER?: "gemini" | "openrouter" | "cf-vision";
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CF_VISION?: string;            // прапорець інтеграції CF Vision
  CF_AI_GATEWAY_BASE?: string;   // (опційно) проксі для Gemini
}

/** Нормалізація шляху: зрізаємо кінцеві слеші */
function normalize(pathname: string): string {
  if (!pathname) return "/";
  const p = pathname.replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

/** Легкий пінг до Gemini через countTokens */
async function geminiPing(env: Env) {
  if (!env.GEMINI_API_KEY) {
    return err("Gemini error: GEMINI_API_KEY is missing", 500);
  }

  const base =
    (env.CF_AI_GATEWAY_BASE && env.CF_AI_GATEWAY_BASE.replace(/\/+$/, "")) ||
    "https://generativelanguage.googleapis.com";

  const model = "gemini-2.0-flash";
  const url = `${base}/v1beta/models/${model}:countTokens?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }] }),
    });

    const text = await r.text();
    if (!text) {
      return ok({
        provider: "gemini",
        raw: { success: false, error: [{ code: 502, message: "Empty body" }] },
        result: null,
      });
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return ok({
        provider: "gemini",
        raw: { success: false, error: [{ code: 502, message: "Bad JSON" }] },
        result: null,
      });
    }

    if (!r.ok) {
      return ok({
        provider: "gemini",
        raw: { success: false, error: [{ code: r.status, message: `HTTP ${r.status}` }] },
        result: null,
      });
    }

    return ok({ provider: "gemini", raw: { success: true, result: json }, result: json });
  } catch (e: any) {
    return ok({
      provider: "gemini",
      raw: { success: false, error: [{ code: 500, message: e?.message }] },
      result: null,
    });
  }
}

/** Список моделей OpenRouter */
async function openrouterListModels(env: Env) {
  if (!env.OPENROUTER_API_KEY) {
    return err("OpenRouter error: OPENROUTER_API_KEY is missing", 500);
  }
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "X-Title": "senti-bot-worker/diagnostics",
      },
    });

    const text = await r.text();
    if (!text) {
      return ok({
        provider: "openrouter",
        raw: { success: false, error: [{ code: 502, message: "Empty body" }] },
      });
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return ok({
        provider: "openrouter",
        raw: { success: false, error: [{ code: 502, message: "Bad JSON" }] },
      });
    }

    if (!r.ok) {
      return ok({
        provider: "openrouter",
        raw: { success: false, error: [{ code: r.status, message: `HTTP ${r.status}` }] },
      });
    }

    return ok({ provider: "openrouter", raw: json });
  } catch (e: any) {
    return err(`OpenRouter error: ${e?.message || String(e)}`, 500);
  }
}

/** Головний роутер діагностики */
export async function handleDiagnostics(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const path = normalize(url.pathname);

  if (path === "/diagnostics") {
    return ok({
      routes: [
        "/diagnostics/ai/provider",
        "/diagnostics/ai/gemini/models",
        "/diagnostics/ai/gemini/ping",
        "/diagnostics/ai/openrouter/models",
        "/diagnostics/ai/cf-vision",
      ],
    });
  }

  if (path === "/diagnostics/ai/provider") return aiTextRouter(env as any);
  if (path === "/diagnostics/ai/gemini/models") return geminiListModels(env as any);
  if (path === "/diagnostics/ai/gemini/ping") return geminiPing(env as any);
  if (path === "/diagnostics/ai/openrouter/models") return openrouterListModels(env as any);
  if (path === "/diagnostics/ai/cf-vision") return cfVision(env as any);

  return null; // нехай index.ts віддасть 404
}