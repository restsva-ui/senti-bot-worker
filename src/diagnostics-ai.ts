// src/diagnostics-ai.ts

import { cfVision, aiTextRouter, geminiListModels, ok, err } from "./ai/providers";

type Env = {
  AI_ENABLED?: string; // "true"/"false"
  AI_PROVIDER?: "gemini" | "openrouter" | "cf-vision";
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CF_VISION?: string;
  CF_AI_GATEWAY_BASE?: string;
};

export async function handleAIDiagnostics(request: Request, env: Env): Promise<Response> {
  // /diagnostics/ai
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, ""); // обрізаємо хвости

  // Жива перевірка, що AI взагалі дозволено
  if (env.AI_ENABLED && env.AI_ENABLED !== "true") {
    return err("AI diagnostics disabled (AI_ENABLED != true)", 403);
  }

  // роутинг
  if (path === "/diagnostics/ai" || path === "/diagnostics/ai/") {
    return ok({
      endpoints: [
        "/diagnostics/ai/provider",
        "/diagnostics/ai/gemini/models",
        "/diagnostics/ai/cf-vision",
      ],
    });
  }

  if (path === "/diagnostics/ai/provider") {
    return aiTextRouter(env);
  }

  if (path === "/diagnostics/ai/gemini/models") {
    return geminiListModels(env);
  }

  if (path === "/diagnostics/ai/cf-vision") {
    return cfVision(env);
  }

  // якщо не знайшли маршрут
  return err("not found", 404);
}

// Додатковий аліас (не обов’язково, але хай буде зручно)
export const handleDiagnosticsAI = handleAIDiagnostics;