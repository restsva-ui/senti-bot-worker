// src/ai/providers.ts

export interface AiTextResult {
  provider: string;
  text: string;
  raw?: unknown;
}

function assert(ok: any, msg: string): asserts ok {
  if (!ok) throw new Error(msg);
}

// ✅ Cloudflare Workers AI (Vision)
export async function runCfVision(
  env: Record<string, string>,
  prompt: string,
  imageUrl: string,
  model = "cf/meta/llama-3.2-11b-vision-instruct",
): Promise<AiTextResult> {
  assert(env.CF_VISION, "CF_VISION is required");
  assert(env.CLOUDFLARE_API_TOKEN, "CLOUDFLARE_API_TOKEN is required");

  const url = `${env.CF_VISION.replace(/\/+$/, "")}/@${model}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_url: imageUrl,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.success === false) {
    throw new Error(
      data?.errors?.[0]?.message || data?.message || `CF Vision ${r.status}`,
    );
  }

  const text =
    data?.result?.response ??
    data?.result?.output_text ??
    data?.response ??
    JSON.stringify(data);

  return { provider: "cf-vision", text, raw: data };
}

// ✅ Gemini (Text API)
export async function runGemini(
  env: Record<string, string>,
  prompt: string,
  model: "models/gemini-1.5-flash" | "models/gemini-1.5-pro" = "models/gemini-1.5-flash",
): Promise<AiTextResult> {
  assert(env.GEMINI_API_KEY, "GEMINI_API_KEY is required");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(
    env.GEMINI_API_KEY,
  )}`;

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 },
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) {
    throw new Error(data?.error?.message || `Gemini ${r.status}`);
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).join("") ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    JSON.stringify(data);

  return { provider: "gemini", text, raw: data };
}

// ✅ OpenRouter (DeepSeek та інші)
export async function runOpenRouter(
  env: Record<string, string>,
  prompt: string,
  model = "deepseek/deepseek-chat",
): Promise<AiTextResult> {
  assert(env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is required");

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.error) {
    throw new Error(
      data?.error?.message || data?.error || `OpenRouter ${r.status}`,
    );
  }

  const text = data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
  return { provider: "openrouter", text, raw: data };
}