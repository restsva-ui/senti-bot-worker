// src/lib/modelRouter.js
// Гнучкий роутер моделей із авто-fallback: Gemini + Cloudflare Workers AI + OpenRouter.

const isRetryable = (s) => [408,409,425,429,500,502,503,504].includes(s);

// ── Gemini (Google AI Studio) ────────────────────────────────────────────────
async function callGemini(env, model, prompt, opts = {}) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.max_tokens ?? 1024,
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`gemini ${model} ${r.status}`); e.status=r.status; e.payload=j; throw e; }
  const out = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!out) { const e = new Error("gemini empty"); e.status=502; e.payload=j; throw e; }
  return out;
}

// ── OpenRouter ───────────────────────────────────────────────────────────────
async function callOpenRouter(env, model, prompt, opts = {}) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
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
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`openrouter ${model} ${r.status}`); e.status=r.status; e.payload=j; throw e; }
  return j?.choices?.[0]?.message?.content ?? "";
}

// ── Cloudflare Workers AI ────────────────────────────────────────────────────
async function callCloudflareAI(env, model, prompt, opts = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${encodeURIComponent(model)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) { const e = new Error(`cf ${model} ${r.status || 500}`); e.status=r.status||500; e.payload=j; throw e; }
  const out = j?.result?.response ?? j?.result?.choices?.[0]?.message?.content ?? "";
  if (!out) { const e = new Error("cf empty"); e.status=502; e.payload=j; throw e; }
  return out;
}

/**
 * env.MODEL_ORDER — "gemini:<id>,cf:<id>,openrouter:<id>"
 * приклад: gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct
 */
export async function askAnyModel(env, prompt, opts = {}) {
  const order = String(env.MODEL_ORDER || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (!order.length) throw new Error("MODEL_ORDER is empty");
  let lastErr = null;

  for (const entry of order) {
    const [provider, ...rest] = entry.split(":");
    const model = rest.join(":");
    try {
      if (provider === "gemini")  return await callGemini(env, model, prompt, opts);
      if (provider === "cf")      return await callCloudflareAI(env, model, prompt, opts);
      if (provider === "openrouter") return await callOpenRouter(env, model, prompt, opts);
      const e = new Error(`Unknown provider: ${provider}`); e.status=400; throw e;
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e.status || 0)) { /* йдемо далі */ }
    }
  }
  throw lastErr || new Error("All models failed");
}