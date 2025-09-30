// src/diagnostics-ai.ts
// Легка діагностика AI: текст, віжн та перелік моделей Gemini.
// НЕ має зовнішніх залежностей на "ok/err/aiTextRouter" тощо.

import { runCfVision, runGemini, runOpenRouter } from "./ai/providers";

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function ok(data: unknown, status = 200) {
  return json({ ok: true, status, data });
}

function err(e: unknown, status = 400) {
  const msg = e instanceof Error ? e.message : String(e);
  return json({ ok: false, status, error: msg });
}

/**
 * Хендлер діагностики AI-ендпоінтів.
 * Повертає Response або null (якщо шлях не належить /ai/*).
 */
export async function handleDiagnosticsAI(
  request: Request,
  env: Record<string, string>,
  url: URL
): Promise<Response | null> {
  if (!url.pathname.startsWith("/ai/")) return null;

  try {
    // GET /ai/text?provider=gemini|openrouter&model=...&prompt=...
    if (request.method === "GET" && url.pathname === "/ai/text") {
      const provider = url.searchParams.get("provider") || "gemini";
      const prompt = url.searchParams.get("prompt") || "Скажи Привіт!";

      if (provider === "gemini") {
        const model = (url.searchParams.get("model") ||
          "models/gemini-1.5-flash") as
          | "models/gemini-1.5-flash"
          | "models/gemini-1.5-pro";
        const out = await runGemini(env, prompt, model);
        return ok(out);
      }

      if (provider === "openrouter") {
        const model = url.searchParams.get("model") || "deepseek/deepseek-chat";
        const out = await runOpenRouter(env, prompt, model);
        return ok(out);
      }

      return err(`Unknown provider "${provider}"`, 400);
    }

    // GET /ai/vision?url=<image_url>&prompt=...&model=...
    if (request.method === "GET" && url.pathname === "/ai/vision") {
      const imageUrl = url.searchParams.get("url");
      const prompt =
        url.searchParams.get("prompt") || "Опиши зображення стисло українською.";
      if (!imageUrl) return err("Missing image url", 400);

      const model =
        url.searchParams.get("model") ||
        "cf/meta/llama-3.2-11b-vision-instruct";

      const out = await runCfVision(env, prompt, imageUrl, model);
      return ok(out);
    }

    // GET /ai/models/gemini  — перелік доступних моделей Gemini (через офіційний ListModels)
    if (request.method === "GET" && url.pathname === "/ai/models/gemini") {
      const key = env.GEMINI_API_KEY;
      if (!key) return err("GEMINI_API_KEY is required", 400);

      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
          key
        )}`
      );
      const data = await r.json().catch(() => ({}));

      if (!r.ok || data?.error) {
        return err(
          data?.error?.message || `Gemini list models failed: ${r.status}`,
          r.status || 500
        );
      }

      // Трохи фільтруємо найкорисніші id
      const models =
        data?.models?.map((m: any) => m?.name).filter(Boolean) ?? [];
      return ok({ models });
    }

    // GET /ai/token/verify?token=<CF_API_TOKEN>
    if (request.method === "GET" && url.pathname === "/ai/token/verify") {
      const token = url.searchParams.get("token");
      if (!token) return err("Missing token", 400);

      const ping = await fetch(
        "https://api.cloudflare.com/client/v4/user/tokens/verify",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await ping.json().catch(() => ({}));
      return ok(data, ping.status);
    }

    return null; // не наш шлях
  } catch (e) {
    return err(e, 400);
  }
}

// Опціонально можна експортувати як default для зручності імпорту
export default handleDiagnosticsAI;