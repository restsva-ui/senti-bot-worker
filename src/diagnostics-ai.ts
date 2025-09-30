// src/diagnostics-ai.ts
import {
  ok,
  err,
  runCfVision,
  runGemini,
  geminiListModels,
  runOpenRouter,
  Env as ProvidersEnv,
} from "./ai/providers";

export interface Env extends ProvidersEnv {}

/**
 * Маршрути діагностики AI:
 * - GET  /ai/cf-vision?image=<url>&prompt=...
 * - GET  /ai/gemini?prompt=...&model=...
 * - GET  /ai/models/gemini
 * - GET  /ai/openrouter?prompt=...&model=...
 *
 * Повертає Response або null (якщо шлях не співпав) — щоб index.ts міг делегувати.
 */
export async function handleAIDiagnostics(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  // /ai/models/gemini — список моделей
  if (url.pathname === "/ai/models/gemini") {
    try {
      const out = await geminiListModels(env);
      return ok(out);
    } catch (e) {
      return err(e, 400);
    }
  }

  // /ai/cf-vision
  if (url.pathname === "/ai/cf-vision") {
    const image = url.searchParams.get("image");
    const prompt = url.searchParams.get("prompt") || "";
    if (!image) return err("query `image` is required", 400);
    try {
      const out = await runCfVision(env, image, prompt);
      return ok(out, 200);
    } catch (e) {
      return err(e, 400);
    }
  }

  // /ai/gemini
  if (url.pathname === "/ai/gemini") {
    const prompt = url.searchParams.get("prompt") || "Привіт! З чого почнемо?";
    const model =
      url.searchParams.get("model") || "gemini-1.5-flash-latest";
    try {
      const out = await runGemini(env, prompt, model);
      return ok(out, 200);
    } catch (e) {
      return err(e, 400);
    }
  }

  // /ai/openrouter
  if (url.pathname === "/ai/openrouter") {
    const prompt = url.searchParams.get("prompt") || "Привет! Чем могу помочь?";
    const model =
      url.searchParams.get("model") || "deepseek/deepseek-chat";
    try {
      const out = await runOpenRouter(env, prompt, model);
      return ok(out, 200);
    } catch (e) {
      return err(e, 400);
    }
  }

  return null;
}