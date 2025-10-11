// src/lib/modelRouter.js
// Гнучкий роутер моделей із авто-fallback (Gemini + Cloudflare Workers AI + OpenRouter)

const isRetryable = (status) => [408, 409, 425, 429, 500, 502, 503, 504].includes(status);

// ── Gemini (Google AI Studio) ────────────────────────────────────────────────
async function callGemini(env, model, prompt, opts = {}) {
  const apiKey = env.GOOGLE_API_KEY || env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error("gemini api key missing");
    err.status = 401;
    throw err;
  }

  // універсальний text-only запит
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }]}],
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

  const out =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ??
    data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data ??
    "";
  return out;
}

// ── Cloudflare Workers AI ────────────────────────────────────────────────────
async function callCloudflareAI(env, model, prompt, opts = {}) {
  if (!env.CF_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    const err = new Error("cf creds missing");
    err.status = 401;
    throw err;
  }

  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/`;
  const url = base + encodeURIComponent(model); // модель типу @cf/meta/llama-3-8b-instruct

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // CF приймає OpenAI-сумісний формат
      messages: [{ role: "user", content: prompt }],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });

  // CF іноді повертає { success:false, errors:[...] } зі статусом 400
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data?.success === false) {
    const status = r.status || 500;
    const errText = data?.errors?.[0]?.message || "cf error";
    const err = new Error(`cf ${model} ${status} ${errText}`);
    err.status = status; err.payload = data;
    throw err;
  }

  const msg =
    data?.result?.response ??
    data?.result?.choices?.[0]?.message?.content ??
    data?.result?.text ??
    "";
  return msg;
}

// ── OpenRouter ───────────────────────────────────────────────────────────────
async function callOpenRouter(env, model, prompt, opts = {}) {
  if (!env.OPENROUTER_API_KEY) {
    const err = new Error("openrouter api key missing");
    err.status = 401;
    throw err;
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
  return data?.choices?.[0]?.message?.content ?? "";
}

/**
 * env.MODEL_ORDER — комами:
 *   gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct,openrouter:deepseek/deepseek-chat
 */
export async function askAnyModel(env, prompt, opts = {}) {
  const order = String(env.MODEL_ORDER || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (order.length === 0) throw new Error("MODEL_ORDER is empty");

  let lastErr = null;

  for (const entry of order) {
    const [provider, ...rest] = entry.split(":");
    const model = rest.join(":"); // підтримує двокрапки/слеші у ідентифікаторі

    try {
      if (provider === "gemini") {
        return await callGemini(env, model, prompt, opts);
      }
      if (provider === "cf") {
        return await callCloudflareAI(env, model, prompt, opts);
      }
      if (provider === "openrouter") {
        return await callOpenRouter(env, model, prompt, opts);
      }
      // невідомий провайдер — пропускаємо до наступного
      lastErr = new Error(`Unknown provider: ${provider}`);
      lastErr.status = 400;
    } catch (e) {
      lastErr = e;
      // Якщо помилка не ретрійна — просто йдемо далі
      if (!isRetryable(e.status || 0)) {
        // no-op, пробуємо наступну модель
      }
    }
  }

  throw lastErr || new Error("All models failed");
}