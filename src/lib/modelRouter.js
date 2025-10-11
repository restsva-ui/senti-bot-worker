// src/lib/modelRouter.js
// Гнучкий роутер моделей із авто-fallback (Cloudflare Workers AI + OpenRouter)
// Працює безкоштовно через CF Workers AI (як перший пріоритет). OpenRouter — як резерв.

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const isRetryable = (s) => RETRYABLE.has(Number(s));

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
  return data?.choices?.[0]?.message?.content ?? "";
}

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
    const err = new Error(`cf ${model} ${status}`);
    err.status = status; err.payload = data;
    throw err;
  }
  // CF може повертати різні поля залежно від моделі
  const msg =
    data?.result?.response ??
    data?.result?.choices?.[0]?.message?.content ??
    "";
  return msg;
}

/**
 * MODEL_ORDER (env): кома-розділений список провайдерів:
 *   "cf:@cf/meta/llama-3.1-8b-instruct,openrouter:google/gemini-flash-1.5"
 * Якщо env.MODEL_ORDER відсутній — використовуємо безкоштовний дефолт:
 *   CF Llama3.1-8B → (резерв) OpenRouter DeepSeek-R1/DST/інша легка
 */
export async function askAnyModel(env, prompt, opts = {}) {
  const fallbackOrder =
    "cf:@cf/meta/llama-3.1-8b-instruct,openrouter:deepseek/deepseek-chat";
  const order = String(env.MODEL_ORDER || fallbackOrder)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let lastErr = null;
  for (const entry of order) {
    const [provider, ...rest] = entry.split(":");
    const model = rest.join(":"); // у model id можуть бути двокрапки

    try {
      if (provider === "openrouter") {
        return await callOpenRouter(env, model, prompt, opts);
      }
      if (provider === "cf") {
        return await callCloudflareAI(env, model, prompt, opts);
      }
      throw new Error(`Unknown provider: ${provider}`);
    } catch (e) {
      lastErr = e;
      // Перейдемо до наступної моделі; ретраї окремо не робимо, бо є інші провайдери
      if (!isRetryable(e.status || 0)) {
        // неретрійна — все одно рухаємось далі
      }
    }
  }
  throw lastErr || new Error("All models failed");
}