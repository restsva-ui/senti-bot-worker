// src/ai/gemini.ts
import { ok, err, type Env } from "./providers";

type TextIn = {
  prompt?: string;
  model?: string;
};

/**
 * Виклик Gemini generateContent для діагностики тексту.
 * GET:  /diagnostics/ai/gemini/text?q=hello&model=models/gemini-2.0-flash-001
 * POST: /diagnostics/ai/gemini/text { "prompt": "hello", "model": "models/gemini-2.0-flash-001" }
 */
export async function geminiText(request: Request, env: Env): Promise<Response> {
  if (!env.GEMINI_API_KEY) {
    return err("Gemini error: GEMINI_API_KEY is missing", 500);
  }

  // читаємо prompt/model з query або з JSON body
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? undefined;
  const m = url.searchParams.get("model") ?? undefined;

  let bodyJson: TextIn = {};
  if (request.method === "POST") {
    try {
      const raw = await request.text();
      if (raw) bodyJson = JSON.parse(raw);
    } catch {
      // ігноруємо — просто не було JSON або він порожній
    }
  }

  const prompt = bodyJson.prompt ?? q ?? "ping";
  // Безпечний стабільний дефолт (є у твоєму списку моделей)
  const model =
    bodyJson.model ??
    m ??
    "models/gemini-2.0-flash-001";

  const base =
    (env.CF_AI_GATEWAY_BASE && env.CF_AI_GATEWAY_BASE.replace(/\/+$/, "")) ||
    "https://generativelanguage.googleapis.com";

  const endpoint = `${base}/v1beta/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  // Мінімальний payload для тексту
  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: String(prompt) }],
      },
    ],
  };

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const txt = await r.text();
    if (!txt) return err("Gemini error: Unexpected end of JSON input", 502);

    let json: any;
    try {
      json = JSON.parse(txt);
    } catch {
      return err("Gemini error: Bad JSON from upstream", 502);
    }

    // Витягуємо перший текст, якщо є
    const first =
      json?.candidates?.[0]?.content?.parts?.[0]?.text ??
      json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ??
      null;

    return ok({
      provider: "gemini",
      model,
      prompt,
      result: first,
      raw: json,
    });
  } catch (e: any) {
    return err(`Gemini error: ${e?.message || String(e)}`, 500);
  }
}