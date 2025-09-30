// src/ai/providers.ts

export interface AIEnv {
  // текстові провайдери
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  // для CF Vision (ми вже налаштували)
  CF_VISION: string;
  CLOUDFLARE_API_TOKEN: string;
}

// ---------------------- helpers ----------------------

async function toJson(resp: Response) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function json(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---------------------- TEXT: Gemini ------------------

export async function geminiText(env: AIEnv, prompt: string) {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is missing");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await toJson(resp);
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${JSON.stringify(data)}`);
  const textOut =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("\n");
  return { provider: "gemini", text: textOut, raw: data };
}

// ---------------------- TEXT: DeepSeek ----------------

export async function deepseekText(env: AIEnv, prompt: string) {
  if (!env.DEEPSEEK_API_KEY) {
    throw new Error("DEEPSEEK_API_KEY is missing");
  }
  const url = "https://api.deepseek.com/chat/completions";
  const body = {
    model: "deepseek-chat",
    messages: [{ role: "user", content: prompt }],
    stream: false,
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await toJson(resp);
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}: ${JSON.stringify(data)}`);
  const textOut = data?.choices?.[0]?.message?.content ?? "";
  return { provider: "deepseek", text: textOut, raw: data };
}

// ---------------------- TEXT: OpenRouter ---------------

export async function openrouterText(env: AIEnv, prompt: string, model?: string) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is missing");
  }
  // За замовчуванням — легка безкоштовна/дешева модель (можеш підмінити)
  const modelName = model || "google/gemini-2.0-flash-exp";
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const body = {
    model: modelName,
    messages: [{ role: "user", content: prompt }],
  };
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
    // ці два заголовки — рекомендовані OpenRouter (не обов’язкові, але корисні для лімітів/аналітики)
    "HTTP-Referer": "https://senti-bot-worker.restsva.workers.dev",
    "X-Title": "senti-bot-worker",
  };
  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await toJson(resp);
  if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${JSON.stringify(data)}`);
  const textOut = data?.choices?.[0]?.message?.content ?? "";
  return { provider: "openrouter", model: modelName, text: textOut, raw: data };
}

// ---------------------- VISION: CF (вже працює) -------

export async function cfVision(env: AIEnv, imageUrl: string, prompt: string) {
  const runUrl = `${env.CF_VISION}/@cf/meta/llama-3.2-11b-vision-instruct`;
  const resp = await fetch(runUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    },
    body: JSON.stringify({ prompt, image_url: imageUrl }),
  });
  const data = await toJson(resp);
  if (!resp.ok) throw new Error(`CF Vision ${resp.status}: ${JSON.stringify(data)}`);
  const textOut = data?.result?.response ?? data?.response ?? "";
  return { provider: "cf-vision", text: textOut, raw: data };
}

// ---------------------- Router -------------------------

export async function aiTextRouter(
  env: AIEnv,
  provider: string,
  prompt: string,
  model?: string
) {
  switch ((provider || "").toLowerCase()) {
    case "gemini":
      return geminiText(env, prompt);
    case "deepseek":
      return deepseekText(env, prompt);
    case "openrouter":
      return openrouterText(env, prompt, model);
    default:
      throw new Error(`Unknown provider: ${provider}. Use gemini | deepseek | openrouter`);
  }
}

export function ok(res: unknown, status = 200) { return json(res, status); }
export function err(e: unknown, status = 500) {
  return json({ ok: false, error: String(e) }, status);
}