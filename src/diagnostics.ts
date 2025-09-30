// src/diagnostics.ts
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

export async function handleDiagnostics(request: Request, env: Record<string, string>, url: URL) {
  // /health уже обробляється в index.ts — тут тільки /ai/*
  if (!url.pathname.startsWith("/ai/")) return null;

  try {
    // GET /ai/text?provider=gemini|openrouter&prompt=...
    if (request.method === "GET" && url.pathname === "/ai/text") {
      const provider = url.searchParams.get("provider") || "gemini";
      const prompt = url.searchParams.get("prompt") || "Скажи Привіт!";

      if (provider === "gemini") {
        const modelParam = (url.searchParams.get("model") ||
          "models/gemini-1.5-flash") as
          | "models/gemini-1.5-flash"
          | "models/gemini-1.5-pro";
        const out = await runGemini(env, prompt, modelParam);
        return ok(out, 200);
      }

      if (provider === "openrouter") {
        const model = url.searchParams.get("model") || "deepseek/deepseek-chat";
        const out = await runOpenRouter(env, prompt, model);
        return ok(out, 200);
      }

      return err(`Unknown provider "${provider}"`, 400);
    }

    // GET /ai/vision?url=<imageUrl>&prompt=...
    if (request.method === "GET" && url.pathname === "/ai/vision") {
      const imageUrl = url.searchParams.get("url");
      const prompt =
        url.searchParams.get("prompt") ||
        "Опиши зображення стисло українською.";
      if (!imageUrl) return err("Missing image url", 400);

      const model =
        url.searchParams.get("model") ||
        "cf/meta/llama-3.2-11b-vision-instruct";

      const out = await runCfVision(env, prompt, imageUrl, model);
      return ok(out, 200);
    }

    // GET /ai/token/verify?token=...
    if (request.method === "GET" && url.pathname === "/ai/token/verify") {
      const token = url.searchParams.get("token");
      if (!token) return err("Missing token", 400);
      // простий пінг у Cloudflare API, щоб переконатись, що токен живий
      const ping = await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await ping.json().catch(() => ({}));
      return ok(data, ping.status);
    }

    // не впізнали маршрут — нехай обробить index.ts
    return null;
  } catch (e) {
    return err(e, 400);
  }
}