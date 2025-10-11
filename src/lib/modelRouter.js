// src/lib/modelRouter.js
// Гнучкий роутер моделей з авто-fallback:
// 1) Gemini (GOOGLE_API_KEY або GEMINI_API_KEY)
// 2) Cloudflare Workers AI
// 3) OpenRouter

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const isRetryable = (s) => RETRYABLE.has(Number(s));

function pick(obj, path, dflt = "") {
  try { return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj) ?? dflt; }
  catch { return dflt; }
}

/* ---------------- Gemini ---------------- */
async function callGemini(env, model, prompt, opts = {}) {
  const GEM_KEY = env.GOOGLE_API_KEY || env.GEMINI_API_KEY; // ← читаємо обидві назви
  if (!GEM_KEY) {
    const e = new Error("GOOGLE_API_KEY/GEMINI_API_KEY missing");
    e.status = 0;
    throw e;
  }
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${GEM_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.max_tokens ?? 1024,
    },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`gemini ${model} ${r.status}`);
    err.status = r.status; err.payload = data;
    throw err;
  }
  return (
    pick(data, "candidates.0.content.parts.0.text") ||
    pick(data, "candidates.0.content.parts.0.inlineData") ||
    ""
  );
}

/* ---------------- OpenRouter ---------------- */
async function callOpenRouter(env, model, prompt, opts = {}) {
  if (!env.OPENROUTER_API_KEY) {
    const e = new Error("OPENROUTER_API_KEY missing");
    e.status = 0;
    throw e;
  }
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.SERVICE_HOST || "https://workers.dev",
      "X-Title": "SentiBot",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`openrouter ${model} ${r.status}`);
    err.status = r.status; err.payload = data;
    throw err;
  }
  return pick(data, "choices.0.message.content", "");
}

/* ---------------- Cloudflare Workers AI ---------------- */
async function callCloudflareAI(env, model, prompt, opts = {}) {
  if (!env.CF_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    const e = new Error("CF creds missing");
    e.status = 0;
    throw e;
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${encodeURIComponent(model)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    const status = r.status || 500;
    const err = new Error(`cf ${model} ${status}: ${pick(data, "errors.0.message", "bad request")}`);
    err.status = status; err.payload = data;
    throw err;
  }
  return (
    pick(data, "result.response") ||
    pick(data, "result.choices.0.message.content") ||
    ""
  );
}

/* ---------------- Router ---------------- */
/**
 * env.MODEL_ORDER: "gemini:<id>,cf:<id>,openrouter:<id>"
 * Дефолт — лише безкоштовні/доступні варіанти:
 *   gemini:gemini-1.5-flash-latest,
 *   cf:@cf/meta/llama-3-8b-instruct,     // ← БЕЗ ".1"
 *   openrouter:deepseek/deepseek-chat
 */
export async function askAnyModel(env, prompt, opts = {}) {
  const fallbackOrder =
    "gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct,openrouter:deepseek/deepseek-chat";

  const order = String(env.MODEL_ORDER || fallbackOrder)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let lastErr = null;

  for (const entry of order) {
    const [provider, ...rest] = entry.split(":");
    const model = rest.join(":");

    try {
      if (provider === "gemini") return await callGemini(env, model, prompt, opts);
      if (provider === "cf") return await callCloudflareAI(env, model, prompt, opts);
      if (provider === "openrouter") return await callOpenRouter(env, model, prompt, opts);
      throw new Error(`Unknown provider: ${provider}`);
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e.status || 0)) {
        // не зупиняємось — пробуємо наступну модель
      }
    }
  }

  throw lastErr || new Error("All models failed");
}