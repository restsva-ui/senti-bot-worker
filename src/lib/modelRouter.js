// Гнучкий роутер моделей із авто-fallback (Gemini + OpenRouter + Cloudflare Workers AI).

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const isRetryable = (s) => RETRYABLE.has(Number(s || 0));

/** Нормалізація назв моделей Gemini до v1 */
function normalizeGemini(model) {
  const m = String(model || "").trim();
  // дозволяємо "gemini-1.5-flash-latest" тощо — зведемо до v1 назв
  return m
    .replace(/-latest$/i, "")
    .replace(/^google\/|^gemini\//i, ""); // на випадок сторонніх префіксів
}

async function callGemini(env, model, prompt, opts = {}) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY missing");

  const mdl = normalizeGemini(model || "gemini-1.5-flash");
  const url = `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(
    mdl
  )}:generateContent?key=${apiKey}`;

  // system передаємо як перший префікс у контенті (Gemini v1 не має явного role=system)
  const sys = opts.system ? String(opts.system) : "";
  const user = String(prompt || "");
  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: sys ? `${sys}\n\n${user}` : user }],
      },
    ],
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
    const err = new Error(`gemini ${mdl} ${r.status}`);
    err.status = r.status;
    err.payload = data;
    throw err;
  }
  const out =
    data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  return out;
}

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
      messages: [
        ...(opts.system ? [{ role: "system", content: String(opts.system) }] : []),
        { role: "user", content: String(prompt || "") },
      ],
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

async function callCloudflareAI(env, model, prompt, opts = {}) {
  if (!env.CF_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw new Error("CF creds missing");

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
      messages: [
        ...(opts.system ? [{ role: "system", content: String(opts.system) }] : []),
        { role: "user", content: String(prompt || "") },
      ],
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
  // у CF залежить від моделі:
  const msg =
    data?.result?.response ??
    data?.result?.choices?.[0]?.message?.content ??
    data?.result?.text ??
    "";
  return msg;
}

/**
 * env.MODEL_ORDER — кома-розділений список: "gemini:<id>,cf:<id>,openrouter:<id>"
 * Приклади:
 *   gemini:gemini-1.5-flash,cf:@cf/meta/llama-3-8b-instruct
 *   gemini:gemini-1.5-flash-8b,openrouter:deepseek/deepseek-chat
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
    const model = rest.join(":");

    try {
      if (provider === "gemini") return await callGemini(env, model, prompt, opts);
      if (provider === "openrouter") {
        if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
        return await callOpenRouter(env, model, prompt, opts);
      }
      if (provider === "cf") return await callCloudflareAI(env, model, prompt, opts);
      throw new Error(`Unknown provider: ${provider}`);
    } catch (e) {
      lastErr = e;
      // неретрійна — одразу до наступної; ретрійна — теж просто пробуємо іншу модель
      if (!isRetryable(e.status)) {
        // no-op, рухаємося далі
      }
    }
  }
  throw lastErr || new Error("All models failed");
}