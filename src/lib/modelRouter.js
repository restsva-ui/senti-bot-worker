// src/lib/modelRouter.js
// Гнучкий роутер моделей із авто-fallback (Gemini + Cloudflare Workers AI + OpenRouter)

const isRetryable = (status) => [408, 409, 425, 429, 500, 502, 503, 504].includes(status);

// ── Gemini (Google AI Studio) ────────────────────────────────────────────────
async function callGemini(env, model, prompt, opts = {}) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY missing");
  // простий формат: весь текст у користувацькій ролі
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
  if (!r.ok) {
    const err = new Error(`gemini ${model} ${r.status}`);
    err.status = r.status; err.payload = j;
    throw err;
  }
  const out = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!out) {
    const err = new Error(`gemini empty`);
    err.status = 502; err.payload = j;
    throw err;
  }
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
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`openrouter ${model} ${r.status}`);
    err.status = r.status; err.payload = data;
    throw err;
  }
  return data?.choices?.[0]?.message?.content ?? "";
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
  const data = await r.json().catch(() => ({}));
  // CF іноді повертає success=false навіть із 200 — страхуємось
  if (!r.ok || data.success === false) {
    const status = r.status || 500;
    const err = new Error(`cf ${model} ${status}`);
    err.status = status; err.payload = data;
    throw err;
  }
  const msg =
    data?.result?.response ??
    data?.result?.choices?.[0]?.message?.content ??
    "";
  if (!msg) {
    const err = new Error(`cf empty`);
    err.status = 502; err.payload = data;
    throw err;
  }
  return msg;
}

/**
 * env.MODEL_ORDER — кома-розділений список провайдерів:
 *   "gemini:<modelId>,cf:<modelId>,openrouter:<modelId>"
 * приклади:
 *   gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct,openrouter:deepseek/deepseek-chat
 */
export async function askAnyModel(env, prompt, opts = {}) {
  const order = String(env.MODEL_ORDER || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (order.length === 0) throw new Error("MODEL_ORDER is empty");

  let lastErr = null;
  for (const entry of order) {
    const [provider, ...rest] = entry.split(":");
    const model = rest.join(":"); // зберігаємо повний id

    try {
      if (provider === "gemini") return await callGemini(env, model, prompt, opts);

      if (provider === "cf") {
        if (!env.CF_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN)
          throw new Error("CF creds missing");
        return await callCloudflareAI(env, model, prompt, opts);
      }

      if (provider === "openrouter") {
        if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
        return await callOpenRouter(env, model, prompt, opts);
      }

      // невідомий провайдер — не стопоримо цикл
      const err = new Error(`Unknown provider: ${provider}`);
      err.status = 400;
      throw err;
    } catch (e) {
      lastErr = e;
      // неретріємі коди — все одно рухаємось далі до наступної моделі
      if (!isRetryable(e.status || 0)) {
        // просто пропускаємо на наступну
      }
    }
  }
  throw lastErr || new Error("All models failed");
}