// src/diagnostics-ai.ts
import {
  aiTextRouter,
  geminiListModels,
  cfVision,
  ok,
  err,
} from "./ai/providers";

export async function handleDiagnosticsAI(request: Request, env: any): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/ai")) return null;

  try {
    // GET /ai/text?provider=gemini|deepseek|openrouter&prompt=...&model=...
    if (url.pathname === "/ai/text") {
      const provider = url.searchParams.get("provider") || "gemini";
      const prompt = url.searchParams.get("prompt") || "Скажи привіт одним словом.";
      const model  = url.searchParams.get("model") || undefined;
      const out = await aiTextRouter(env as any, provider, prompt, model);
      return ok({ ok: true, provider, model: out?.model, text: out.text, raw: out.raw });
    }

    // GET /ai/models?provider=gemini
    if (url.pathname === "/ai/models") {
      const provider = (url.searchParams.get("provider") || "gemini").toLowerCase();
      if (provider !== "gemini") {
        return err(`Listing supported only for provider=gemini`, 400);
      }
      const data = await geminiListModels(env as any);
      return ok({ ok: true, provider: "gemini", count: data?.models?.length ?? 0, data });
    }

    // GET /ai/vision?image=<url>&prompt=...
    if (url.pathname === "/ai/vision") {
      const image = url.searchParams.get("image")
        || "https://upload.wikimedia.org/wikipedia/commons/9/99/Black_square.jpg";
      const prompt = url.searchParams.get("prompt") || "Опиши це зображення коротко.";
      const out = await cfVision(env as any, image, prompt);
      return ok({ ok: true, provider: "cf-vision", text: out.text, raw: out.raw });
    }

    return err("Unknown /ai route", 404);
  } catch (e) {
    return err(e);
  }
}