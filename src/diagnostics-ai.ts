// src/diagnostics-ai.ts
// Діагностичні ендпоїнти для AI-провайдерів (Cloudflare Worker).
// Підтримує:
//   GET  /ai/vision/cf?img=<URL>&q=<prompt>   -> простий sanity-check CF Vision (за твоєю логікою в providers)
//   GET  /ai/models/gemini                     -> список моделей Gemini
//   GET  /ai/text/gemini?q=...&model=...       -> простий текст через Gemini (JSON, діагностика)
//   POST /ai/text/gemini                       -> { q, model } у тілі
//   GET  /ai/text/openrouter                   -> повертає активного провайдера (як і було у тебе)
//   GET  /diagnostics/ai/gemini/text           -> те саме, що /ai/text/gemini, для зручності діагностики
//
// ВАЖЛИВО: Експортуємо саме handleAIDiagnostics(request, env, url), бо diagnostics.ts викликає з 3-ма аргументами.

import {
  cfVision,
  aiTextRouter,
  geminiListModels,
  ok,
  err,
  // нова функція, яку ти додав у providers.ts
  geminiText,
} from "./ai/providers";

interface Env {
  // базові ключі/флаги з твого проєкту (розширювано без Strict)
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  CF_VISION?: string;
  CF_AI_GATEWAY_BASE?: string;
  CLOUDFLARE_API_TOKEN?: string;
  [k: string]: unknown;
}

// Допоміжний хелпер для єдиного JSON-виходу без дублю коду
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export async function handleAIDiagnostics(
  request: Request,
  env: Env,
  url: URL
): Promise<Response | null> {
  const path = url.pathname;

  // ───────── CF Vision (GET) — sanity check присутності секрету/провайдера
  // /ai/vision/cf?img=<URL>&q=<prompt>
  if (request.method === "GET" && path === "/ai/vision/cf") {
    // твій providers.cfVision вже повертає готовий Response (ok/err)
    return cfVision(env as any);
  }

  // ───────── Gemini: список моделей (GET)
  // /ai/models/gemini
  if (request.method === "GET" && path === "/ai/models/gemini") {
    return geminiListModels(env as any);
  }

  // ───────── Gemini: текст (GET)
  // /ai/text/gemini?q=...&model=models/gemini-2.5-flash
  if (request.method === "GET" && path === "/ai/text/gemini") {
    const q = url.searchParams.get("q") || "ping from diagnostics";
    const model = url.searchParams.get("model") || undefined;

    const raw = await geminiText(env as any, q, model);
    // Вирівнюємо відповідь у звичний формат твоїх діагностик
    return ok({ provider: "gemini", raw });
  }

  // ───────── Gemini: текст (POST)
  // body: { "q": "...", "model": "models/gemini-2.5-flash" }
  if (request.method === "POST" && path === "/ai/text/gemini") {
    let body: any = null;
    try {
      body = await request.json();
    } catch {
      return err("bad json", 400);
    }

    const q: string = body?.q ?? body?.prompt ?? "";
    const model: string | undefined = body?.model || undefined;
    if (!q) return err("missing 'q' in body", 400);

    const raw = await geminiText(env as any, q, model);
    return ok({ provider: "gemini", raw });
  }

  // ───────── OpenRouter: (як у тебе було) — просто повертаємо активного провайдера
  // /ai/text/openrouter
  if (request.method === "GET" && path === "/ai/text/openrouter") {
    return aiTextRouter(env as any); // поверне {"provider": "..."} — як ти бачив у скрінах
  }

  // ───────── ДУБЛЬ-МАРШРУТ ДЛЯ ДІАГНОСТИКИ (зручний неймспейс)
  // /diagnostics/ai/gemini/text?q=...&model=...
  if (request.method === "GET" && path === "/diagnostics/ai/gemini/text") {
    const q = url.searchParams.get("q") || "ping from diagnostics";
    const model = url.searchParams.get("model") || undefined;

    const raw = await geminiText(env as any, q, model);
    return json({ ok: true, status: 200, data: { provider: "gemini", raw } }, 200);
  }

  // Не наш маршрут — віддаємо управління вищому роутеру
  return null;
}

// Для зворотної сумісності, якщо десь імпортувалось інше ім'я
export const handleDiagnosticsAI = handleAIDiagnostics;