// src/lib/modelRouter.js
// Гнучкий роутер моделей із авто-fallback (OpenRouter + CF Workers AI)

const isRetryable = (status) => [408, 409, 425, 429, 500, 502, 503, 504].includes(status);

async function callOpenRouter(env, model, prompt, opts = {}) {
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

async function callCloudflareAI(env, model, prompt, opts = {}) {
  // REST API до Workers AI
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
    const err = new Error(`cf ${model} ${status}`);
    err.status = status; err.payload = data;
    throw err;
  }
  // Відповідь у CF AI залежить від моделі. Підтримуємо стандартний chat формат:
  const msg = data?.result?.response ?? data?.result?.choices?.[0]?.message?.content ?? "";
  return msg;
}

/**
 * env.MODEL_ORDER: кома-розділений список провайдерів:
 *   "openrouter:<modelId>,cf:<modelId>,openrouter:<modelId>"
 * приклади:
 *   openrouter:meta-llama/llama-3.1-8b-instruct,openrouter:deepseek/deepseek-coder,cf:@cf/meta/llama-3.1-8b-instruct
 */
export async function askAnyModel(env, prompt, opts = {}) {
  const order = String(env.MODEL_ORDER || "").split(",").map(s => s.trim()).filter(Boolean);
  if (order.length === 0) {
    throw new Error("MODEL_ORDER is empty");
  }

  let lastErr = null;
  for (const entry of order) {
    const [provider, ...rest] = entry.split(":");
    const model = rest.join(":"); // бо в id є двокрапки/слеші

    try {
      if (provider === "openrouter") {
        if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
        return await callOpenRouter(env, model, prompt, opts);
      }
      if (provider === "cf") {
        if (!env.CF_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw new Error("CF creds missing");
        return await callCloudflareAI(env, model, prompt, opts);
      }
      throw new Error(`Unknown provider: ${provider}`);
    } catch (e) {
      lastErr = e;
      // retry only if має сенс; інакше — одразу next
      if (!isRetryable(e.status || 0)) {
        // неретрійна помилка -> пробуємо наступну модель, але логнемо
      }
      // продовжимо на наступну модель по списку
    }
  }
  throw lastErr || new Error("All models failed");
}