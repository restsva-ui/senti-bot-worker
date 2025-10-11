// src/lib/modelRouter.js
// Гнучкий роутер моделей із авто-fallback (OpenRouter + CF Workers AI + Gemini)
// Підтримує system-підказку через opts.system

const isRetryable = (status) =>
  [408, 409, 425, 429, 500, 502, 503, 504].includes(status);

// ---------- OpenRouter ----------
async function callOpenRouter(env, model, prompt, opts = {}) {
  const msgs = [];
  if (opts.system) msgs.push({ role: "system", content: String(opts.system) });
  msgs.push({ role: "user", content: String(prompt) });

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
      messages: msgs,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`openrouter ${model} ${r.status}`);
    err.status = r.status;
    err.payload = data;
    throw err;
  }
  return data?.choices?.[0]?.message?.content ?? "";
}

// ---------- Cloudflare Workers AI ----------
async function callCloudflareAI(env, model, prompt, opts = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${encodeURIComponent(model)}`;

  const messages = [];
  if (opts.system) messages.push({ role: "system", content: String(opts.system) });
  messages.push({ role: "user", content: String(prompt) });

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.success === false) {
    const status = r.status || 500;
    const err = new Error(`cf ${model} ${status}`);
    err.status = status;
    err.payload = data;
    throw err;
  }

  // деякі CF-моделі повертають response, деякі — choices
  const msg = data?.result?.response ?? data?.result?.choices?.[0]?.message?.content ?? "";
  return msg;
}

// ---------- Gemini ----------
async function callGemini(env, model, prompt, opts = {}) {
  // key з GEMINI_API_KEY або GOOGLE_API_KEY (обидва підтримуються)
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) {
    const err = new Error("GEMINI_API_KEY/GOOGLE_API_KEY missing");
    err.status = 0;
    throw err;
  }

  const endpointModel = encodeURIComponent(model || "gemini-1.5-flash-latest");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${endpointModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Gemini не має класичної ролі system — дамо system як преамбулу
  const text = opts.system ? `${String(opts.system).trim()}\n\n${String(prompt)}` : String(prompt);

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.4,
        maxOutputTokens: opts.max_tokens ?? 1024,
      },
    }),
  });

  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(`gemini ${model} ${r.status}`);
    err.status = r.status;
    err.payload = d;
    throw err;
  }

  // Витягуємо текст з parts
  const textOut = (d?.candidates?.[0]?.content?.parts || [])
    .map((p) => p?.text)
    .filter(Boolean)
    .join("\n");
  return textOut || "";
}

/**
 * env.MODEL_ORDER — кома-розділений список провайдерів у порядку fallback:
 *   "openrouter:<modelId>,cf:<modelId>,gemini:<modelId>,openrouter:<modelId>"
 * приклади:
 *   openrouter:openrouter/auto,cf:@cf/meta/llama-3.1-8b-instruct,gemini:gemini-1.5-flash-latest
 */
export async function askAnyModel(env, prompt, opts = {}) {
  const order = String(env.MODEL_ORDER || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (order.length === 0) {
    const err = new Error("MODEL_ORDER is empty");
    err.status = 0;
    throw err;
  }

  let lastErr = null;

  for (const entry of order) {
    const [provider, ...rest] = entry.split(":");
    const model = rest.join(":"); // підтримка ідентифікаторів із двокрапками/слешами

    try {
      if (provider === "openrouter") {
        if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
        return await callOpenRouter(env, model, prompt, opts);
      }
      if (provider === "cf") {
        if (!env.CF_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw new Error("CF creds missing");
        return await callCloudflareAI(env, model, prompt, opts);
      }
      if (provider === "gemini") {
        return await callGemini(env, model, prompt, opts);
      }
      throw new Error(`Unknown provider: ${provider}`);
    } catch (e) {
      lastErr = e;
      // якщо помилка не ретрійна — просто йдемо до наступної моделі
      if (!isRetryable(e.status || 0)) {
        // можемо залогувати в чекліст за бажанням
      }
      // продовжуємо по ланцюжку
    }
  }

  throw lastErr || new Error("All models failed");
}