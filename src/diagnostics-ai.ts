// src/diagnostics-ai.ts
// Службові AI-ендпоїнти для ручних перевірок.

import {
  cfVision,
  aiTextRouter,
  geminiListModels,
  ok,
  err,
} from "./ai/providers";

interface Env {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CF_VISION?: string;
  CLOUDFLARE_API_TOKEN?: string;
  [k: string]: unknown;
}

// ГОЛОВНИЙ ХЕНДЛЕР AI ДІАГНОСТИКИ
export async function handleDiagnosticsAI(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  const path = url.pathname;

  // ───────── CF Vision (GET)
  // /ai/vision/cf?img=<URL>&q=<prompt>
  if (request.method === "GET" && path === "/ai/vision/cf") {
    const img = url.searchParams.get("img") || "";
    const q = url.searchParams.get("q") || "Опиши зображення.";
    if (!img) return err("missing 'img' query param", 400);

    try {
      const out = await cfVision(env as any, img, q);
      return ok({ provider: "cf-vision", text: out.text, raw: out.raw });
    } catch (e: any) {
      return err(`CF Vision error: ${e?.message || String(e)}`, 500);
    }
  }

  // ───────── Gemini: список моделей (GET)
  // /ai/models/gemini
  if (request.method === "GET" && path === "/ai/models/gemini") {
    try {
      const models = await geminiListModels(env as any);
      return ok({ provider: "gemini", ...models });
    } catch (e: any) {
      return err(`Gemini listModels error: ${e?.message || String(e)}`, 500);
    }
  }

  // ───────── Gemini: текст (GET)
  // /ai/text/gemini?model=<model>&q=<text>
  if (request.method === "GET" && path === "/ai/text/gemini") {
    const q = url.searchParams.get("q") || "";
    const model = url.searchParams.get("model") || "models/gemini-2.5-flash";
    if (!q) return err("missing 'q' query param", 400);

    try {
      const out = await aiTextRouter(env as any, "gemini", q, model);
      return ok({ provider: "gemini", text: out.text, raw: out.raw });
    } catch (e: any) {
      return err(`Gemini error: ${e?.message || String(e)}`, 500);
    }
  }

  // ───────── Gemini: текст (POST)
  // body: { "q": "...", "model": "models/gemini-2.5-flash" }
  if (request.method === "POST" && path === "/ai/text/gemini") {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return err("bad json", 400);
    }

    const q: string = body?.q ?? body?.prompt ?? "";
    const model: string = body?.model ?? "models/gemini-2.5-flash";
    if (!q) return err("missing 'q' in body", 400);

    try {
      const out = await aiTextRouter(env as any, "gemini", q, model);
      return ok({ provider: "gemini", text: out.text, raw: out.raw });
    } catch (e: any) {
      return err(`Gemini error: ${e?.message || String(e)}`, 500);
    }
  }

  // ───────── OpenRouter: текст (GET)
  // /ai/text/openrouter?model=<model>&q=<text>
  if (request.method === "GET" && path === "/ai/text/openrouter") {
    const q = url.searchParams.get("q") || "";
    const model = url.searchParams.get("model") || "deepseek/deepseek-chat";
    if (!q) return err("missing 'q' query param", 400);

    try {
      const out = await aiTextRouter(env as any, "openrouter", q, model);
      return ok({ provider: "openrouter", text: out.text, raw: out.raw });
    } catch (e: any) {
      return err(`OpenRouter error: ${e?.message || String(e)}`, 500);
    }
  }

  return null;
}

// Для зворотної сумісності з існуючим імпортом у diagnostics.ts:
export { handleDiagnosticsAI as handleAIDiagnostics };