// src/diagnostics.ts
import { ok, err } from "./ai/providers";
import { handleAIDiagnostics } from "./diagnostics-ai";

export interface Env {
  BOT_TOKEN: string;
  TELEGRAM_SECRET_TOKEN?: string;
  WEBHOOK_SECRET?: string;
  CF_VISION: string;
  CLOUDFLARE_API_TOKEN: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
}

/**
 * Основні діагностичні маршрути:
 * - GET /diag/ping
 * - GET /diag/env
 * + делегування у handleAIDiagnostics (AI тести)
 */
export async function handleDiagnostics(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  // 🔹 AI diagnostics (CF Vision, Gemini, OpenRouter)
  const ai = await handleAIDiagnostics(request, env, url);
  if (ai) return ai;

  // /diag/ping
  if (url.pathname === "/diag/ping") {
    return ok({ pong: true, ts: Date.now() });
  }

  // /diag/env
  if (url.pathname === "/diag/env") {
    return ok({
      BOT_TOKEN: env.BOT_TOKEN ? "set" : "missing",
      CF_VISION: env.CF_VISION ? "set" : "missing",
      CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN ? "set" : "missing",
      GEMINI_API_KEY: env.GEMINI_API_KEY ? "set" : "missing",
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY ? "set" : "missing",
    });
  }

  return null;
}