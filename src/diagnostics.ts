// src/diagnostics.ts
import { aiTextRouter, ok, err } from "./ai/providers";

export async function handleDiagnostics(request: Request, env: any): Promise<Response | null> {
  const url = new URL(request.url);

  // health check
  if (url.pathname === "/ping") {
    return new Response("pong", { status: 200 });
  }

  // token verify
  if (url.pathname === "/token-verify") {
    return ok({ ok: true, message: "API Token check stub (set real later)" });
  }

  // vision test
  if (url.pathname === "/vision-test") {
    try {
      const imageUrl =
        url.searchParams.get("image") ||
        "https://upload.wikimedia.org/wikipedia/commons/9/99/Black_square.jpg";
      const prompt = url.searchParams.get("prompt") || "Опиши це зображення одним словом.";
      const runUrl = `${env.CF_VISION}/@cf/meta/llama-3.2-11b-vision-instruct`;
      const resp = await fetch(runUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        },
        body: JSON.stringify({ prompt, image_url: imageUrl }),
      });
      const data = await resp.json<any>();
      return ok({ ok: true, data });
    } catch (e) {
      return err(e);
    }
  }

  // ai-text test
  if (url.pathname === "/ai-text") {
    try {
      const provider = url.searchParams.get("provider") || "gemini";
      const prompt = url.searchParams.get("prompt") || "Скажи привіт одним словом.";
      const model = url.searchParams.get("model") || undefined;

      const out = await aiTextRouter(env as any, provider, prompt, model);
      return ok({
        ok: true,
        provider,
        model: out?.model,
        text: out.text,
        raw: out.raw,
      });
    } catch (e) {
      return err(e);
    }
  }

  // якщо діагностика не збіглася → null (щоб інші роутери обробляли)
  return null;
}