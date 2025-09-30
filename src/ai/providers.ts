// src/ai/providers.ts

export interface AIEnv {
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  OPENROUTER_API_KEY?: string;

  CF_VISION: string;
  CLOUDFLARE_API_TOKEN: string;
}

// ---------- utils ----------
async function toJson(resp: Response) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
function j(res: unknown, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { "content-type": "application/json" },
  });
}
export const ok = (res: unknown, status = 200) => j(res, status);
export const err = (e: unknown, status = 500) => j({ ok: false, error: String(e) }, status);

// ---------- GEMINI ----------
const GEMINI_MODEL_DEFAULT = "gemini-1.5-flash-latest";

export async function geminiText(env: AIEnv, prompt: string, model?: string) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");
  const mdl = model || GEMINI_MODEL_DEFAULT;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mdl)}:generateContent` +
    `?key=${env.GEMINI_API_KEY}`;
  const body = { contents: [{ parts: [{ text: prompt }] }] };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await toJson(resp);
  if (!resp.ok) throw new Error(`Gemini ${resp.status}: ${JSON.stringify(data)}`);
  const textOut =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join("\n") ??
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return { provider: "gemini", model: mdl, text: textOut, raw: data };
}

export async function geminiListModels(env: AIEnv) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`;
  const resp = await fetch(url);
  const data = await toJson(resp);
  if (!resp.ok) throw new Error(`Gemini list ${resp.status}: ${JSON.stringify(data)}`);
  return data;
}

// ---------- DEEPSEEK ----------
export async function deepseekText(env: AIEnv, prompt: string, model?: string) {
  if (!env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY is missing");
  const mdl = model || "deepseek-chat";
  const resp = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: mdl,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });
  const data = await toJson(resp);
  if (!resp.ok) throw new Error(`DeepSeek ${resp.status}: ${JSON.stringify(data)}`);
  const textOut = data?.choices?.[0]?.message?.content ?? "";
  return { provider: "deepseek", model: mdl, text: textOut, raw: data };
}

// ---------- OPENROUTER ----------
export async function openrouterText(env: AIEnv, prompt: string, model?: string) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing");
  const mdl = model || "google/gemini-2.0-flash-exp";
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://senti-bot-worker.restsva.workers.dev",
      "X-Title": "senti-bot-worker",
    },
    body: JSON.stringify({ model: mdl, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await toJson(resp);
  if (!resp.ok) throw new Error(`OpenRouter ${resp.status}: ${JSON.stringify(data)}`);
  const textOut = data?.choices?.[0]?.message?.content ?? "";
  return { provider: "openrouter", model: mdl, text: textOut, raw: data };
}

// ---------- CF VISION ----------
export async function cfVision(env: AIEnv, imageUrl: string, prompt: string) {
  const runUrl = `${env.CF_VISION}/@cf/meta/llama-3.2-11b-vision-instruct`;
  const resp = await fetch(runUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    },
    body: JSON.stringify({ prompt, image_url: imageUrl }),
  });
  const data = await toJson(resp);
  if (!resp.ok) throw new Error(`CF Vision ${resp.status}: ${JSON.stringify(data)}`);
  const textOut = data?.result?.response ?? data?.response ?? "";
  return { provider: "cf-vision", text: textOut, raw: data };
}

// ---------- Router ----------
export async function aiTextRouter(env: AIEnv, provider: string, prompt: string, model?: string) {
  switch ((provider || "").toLowerCase()) {
    case "gemini":     return geminiText(env, prompt, model);
    case "deepseek":   return deepseekText(env, prompt, model);
    case "openrouter": return openrouterText(env, prompt, model);
    default:
      throw new Error(`Unknown provider: ${provider}. Use gemini | deepseek | openrouter`);
  }
}