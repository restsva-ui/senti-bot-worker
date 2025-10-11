// src/lib/modelRouter.js
// Гнучкий роутер моделей із авто-fallback (OpenRouter + Cloudflare Workers AI + Gemini)

const isRetryable = (status) =>
  [408, 409, 425, 429, 500, 502, 503, 504].includes(status);

/* ----------------------------- OpenRouter ------------------------------ */
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
    const err = new Error(
      `OpenRouter(${model}) HTTP ${r.status}${
        data?.error ? `: ${data.error?.message || data.error}` : ""
      }`
    );
    err.status = r.status;
    err.payload = data;
    throw err;
  }
  return data?.choices?.[0]?.message?.content ?? "";
}

/* --------------------------- Cloudflare AI ----------------------------- */
async function callCloudflareAI(env, model, prompt, opts = {}) {
  // приклад model: "@cf/meta/llama-3-8b-instruct"
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${encodeURIComponent(
    model
  )}`;
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
  // У Workers AI, коли модель недоступна/неактивна — часто 400 "No route for that URI"
  if (!r.ok || data.success === false) {
    const status = r.status || 500;
    const msg =
      data?.errors?.[0]?.message ||
      data?.messages?.[0] ||
      data?.error ||
      "Unknown error";
    const err = new Error(`CloudflareAI(${model}) HTTP ${status}: ${msg}`);
    err.status = status;
    err.payload = data;
    throw err;
  }
  // різні моделі повертають різні форми — нормалізуємо
  return (
    data?.result?.response ||
    data?.result?.output_text ||
    data?.result?.choices?.[0]?.message?.content ||
    ""
  );
}

/* -------------------------------- Gemini ------------------------------- */
// Підтримуємо і GEMINI_API_KEY, і GOOGLE_API_KEY (AI Studio)
async function callGemini(env, model, prompt, opts = {}) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!key) throw new Error("Gemini API key missing");

  // Дозволяємо кілька поширених назв
  // "gemini-1.5-flash-latest", "gemini-1.5-flash", "1.5-flash"
  const norm =
    model?.trim() ||
    "gemini-1.5-flash-latest";

  const modelId = norm.includes("gemini")
    ? norm
    : `gemini-${norm}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId
  )}:generateContent?key=${key}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: String(prompt || "") }] }],
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
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg =
      j?.error?.message ||
      j?.error?.status ||
      "Gemini request failed";
    const err = new Error(`Gemini(${modelId}) HTTP ${r.status}: ${msg}`);
    err.status = r.status;
    err.payload = j;
    throw err;
  }
  return j?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/* ------------------------------- ROUTER -------------------------------- */
/**
 * env.MODEL_ORDER — кома-розділений список у форматі:
 *   "gemini:gemini-1.5-flash-latest,cf:@cf/meta/llama-3-8b-instruct,openrouter:deepseek/deepseek-chat"
 */
export async function askAnyModel(env, prompt, opts = {}) {
  const order = String(env.MODEL_ORDER || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (order.length === 0) {
    throw new Error("MODEL_ORDER is empty");
  }

  let lastErr = null;

  for (const entry of order) {
    const [provider, ...rest] = entry.split(":");
    const model = rest.join(":"); // у деяких id є двокрапки

    try {
      if (provider === "openrouter") {
        if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
        return await callOpenRouter(env, model, prompt, opts);
      }
      if (provider === "cf") {
        if (!env.CF_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN)
          throw new Error("CF creds missing");
        return await callCloudflareAI(env, model, prompt, opts);
      }
      if (provider === "gemini") {
        return await callGemini(env, model, prompt, opts);
      }
      throw new Error(`Unknown provider: ${provider}`);
    } catch (e) {
      lastErr = e;
      // продовжуємо на наступну модель; повторні спроби не робимо, щоб не блокувати чат
    }
  }

  throw lastErr || new Error("All models failed");
}