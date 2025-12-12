// src/lib/modelRouter.js
// Router для LLM/Vision провайдерів: Gemini / Cloudflare Workers AI / OpenRouter
// - єдине місце, де визначається пріоритет моделей (черга)
// - акуратний фолбек при помилках
// - "diag" режим у відповіді (через env.DIAG_TAGS)

import { diagWrap } from "./diag.js";

// ------------------------------
// Helpers
// ------------------------------

function splitOrder(str) {
  return String(str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickOrder(env, kind) {
  const key =
    kind === "vision"
      ? "MODEL_ORDER_VISION"
      : kind === "code"
        ? "MODEL_ORDER_CODE"
        : kind === "text"
          ? "MODEL_ORDER_TEXT"
          : "MODEL_ORDER";

  const raw = env?.[key] || env?.MODEL_ORDER || "";
  return splitOrder(raw);
}

function normalizeProviderEntry(entry) {
  // формат: "provider:model"
  // приклад: "gemini:gemini-2.5-flash"
  //         "cf:@cf/meta/llama-3.2-11b-instruct"
  //         "openrouter:qwen/qwen3-coder:free"
  const s = String(entry || "").trim();
  const idx = s.indexOf(":");
  if (idx === -1) return { provider: "cf", model: s };
  return { provider: s.slice(0, idx).trim(), model: s.slice(idx + 1).trim() };
}

function lastN(arr, n) {
  const a = Array.isArray(arr) ? arr : [];
  return a.slice(Math.max(0, a.length - n));
}

function toTextFromAny(x) {
  if (typeof x === "string") return x;
  if (!x) return "";
  if (Array.isArray(x)) return x.map(toTextFromAny).join("\n");
  if (typeof x === "object") return JSON.stringify(x);
  return String(x);
}

// ------------------------------
// Gemini
// ------------------------------

async function callGemini({ env, messages, model, temperature = 0.5 }) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  // Normalize model (accept "models/..." too)
  const raw = String(model || env.GEMINI_MODEL || "gemini-1.5-flash").trim();
  const baseModel = raw.startsWith("models/") ? raw.slice("models/".length) : raw;

  // Try a small set of likely-valid variants to avoid hard failures when Google changes model aliases.
  const candidates = [];
  const push = (m) => { if (m && !candidates.includes(m)) candidates.push(m); };

  push(baseModel);
  // Common alias pattern
  if (!/-(\d{3}|latest)$/.test(baseModel)) push(`${baseModel}-latest`);
  // Safe fallbacks (only if caller asked for a newer/unknown model)
  push("gemini-1.5-flash-latest");
  push("gemini-1.5-pro-latest");

  // Convert chat messages to Gemini "contents"
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content || "" }],
  }));

  const body = {
    contents,
    generationConfig: { temperature },
  };

  const tryOne = async (apiVersion, m) => {
    const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data?.error?.message || `Gemini HTTP ${resp.status}`;
      const err = new Error(msg);
      err.status = resp.status;
      err.apiVersion = apiVersion;
      err.model = m;
      throw err;
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return text.trim();
  };

  let lastErr;
  // Prefer v1; fall back to v1beta for older accounts/regions.
  for (const apiVersion of ["v1", "v1beta"]) {
    for (const m of candidates) {
      try {
        return await tryOne(apiVersion, m);
      } catch (e) {
        lastErr = e;
        // Only keep trying if it's plausibly a "model alias" issue or transient.
        // For auth/quota errors, fail fast.
        const s = Number(e?.status || 0);
        const msg = String(e?.message || "");
        const aliasish = s === 404 || /not found|is not found|model/i.test(msg);
        const transient = s === 429 || s === 500 || s === 503;
        if (!(aliasish || transient)) throw e;
      }
    }
  }
  throw lastErr || new Error("Gemini call failed");
}
// ------------------------------
// Cloudflare Workers AI
// ------------------------------

async function callCfAi({ env, messages, model, temperature = 0.5 }) {
  // очікуємо env.AI (binding) або env.CF_ACCOUNT_ID + fetch до AI endpoint
  if (!env?.AI) {
    // якщо у тебе реалізація через fetch - тут можна доповнити,
    // але в цьому репо використовується binding AI
    throw new Error("Missing AI binding (env.AI)");
  }

  const prompt = messages
    .map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${m.content}`)
    .join("\n");

  const res = await env.AI.run(model, {
    prompt,
    temperature,
  });

  // Workers AI часто повертає { response: "..."} або string
  return (res?.response ?? res ?? "").toString().trim();
}

// ------------------------------
// OpenRouter
// ------------------------------

async function callOpenRouter({ env, messages, model, temperature = 0.5 }) {
  const apiKey = env.OPENROUTER_API_KEY || env.FREE_API_KEY || env.FREE_LLM_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  const baseUrl = (env.FREE_API_BASE_URL || env.FREE_LLM_BASE_URL || "https://openrouter.ai/api").replace(/\/$/, "");
  const path = env.FREE_API_PATH || "/v1/chat/completions";
  const url = `${baseUrl}${path}`;

  const headers = {
    "content-type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  if (env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = env.OPENROUTER_SITE_URL;
  if (env.OPENROUTER_APP_NAME) headers["X-Title"] = env.OPENROUTER_APP_NAME;

  const body = {
    model,
    temperature,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg =
      data?.error?.message ||
      data?.error ||
      `OpenRouter HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  const text =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    "";
  return String(text).trim();
}

// ------------------------------
// Public API
// ------------------------------

export async function askAnyModel(env, messages, opts = {}) {
  const kind = opts.kind || "text";
  const temperature =
    typeof opts.temperature === "number" ? opts.temperature : 0.5;

  const order = pickOrder(env, kind);
  if (!order.length) throw new Error("MODEL_ORDER is empty");

  const errors = [];
  for (const entry of order) {
    const { provider, model } = normalizeProviderEntry(entry);

    try {
      if (provider === "gemini") {
        const out = await callGemini({ env, messages, model, temperature });
        return out;
      }

      if (provider === "cf") {
        const out = await callCfAi({ env, messages, model, temperature });
        return out;
      }

      if (provider === "openrouter" || provider === "free") {
        const out = await callOpenRouter({ env, messages, model, temperature });
        return out;
      }

      throw new Error(`Unknown provider: ${provider}`);
    } catch (e) {
      errors.push({
        provider,
        model,
        message: String(e?.message || e),
      });
      continue;
    }
  }

  const last = errors[errors.length - 1];
  const msg = last?.message || "No providers succeeded";
  const err = new Error(msg);
  err.errors = errors;
  throw err;
}
export async function askVision(env, prompt, imageUrl, opts = {}) {
  const temperature =
    typeof opts.temperature === "number" ? opts.temperature : 0.2;

  const order = pickOrder(env, "vision");
  if (!order.length) throw new Error("MODEL_ORDER_VISION is empty");

  const messages = [
    { role: "user", content: prompt || "Describe the image." },
  ];

  // У цьому репо vision зазвичай йде через CF Vision або Gemini Vision.
  // Для простоти: якщо провайдер gemini — додаємо URL у текст, якщо cf — так само.
  // (Якщо треба "inline image bytes" — робиться окремо через TG.getFile + fetch arrayBuffer.)
  const withImage = [
    {
      role: "user",
      content: `${prompt || "Describe the image."}\nImage URL: ${imageUrl}`,
    },
  ];

  const errors = [];
  for (const entry of order) {
    const { provider, model } = normalizeProviderEntry(entry);

    try {
      if (provider === "gemini") {
        const out = await callGemini({
          env,
          messages: withImage,
          model,
          temperature,
        });
        return out;
      }

      if (provider === "cf") {
        const out = await callCfAi({
          env,
          messages: withImage,
          model,
          temperature,
        });
        return out;
      }

      if (provider === "openrouter" || provider === "free") {
        const out = await callOpenRouter({
          env,
          messages: withImage,
          model,
          temperature,
        });
        return out;
      }

      throw new Error(`Unknown provider: ${provider}`);
    } catch (e) {
      errors.push({
        provider,
        model,
        message: String(e?.message || e),
      });
      continue;
    }
  }

  const last = errors[errors.length - 1];
  const msg = last?.message || "No vision providers succeeded";
  const err = new Error(msg);
  err.errors = errors;
  throw err;
}

// ------------------------------
// Optional: diagnostic wrapper
// ------------------------------

export function askAnyModelDiag(env, messages, opts = {}) {
  return diagWrap(env, async () => {
    const out = await askAnyModel(env, messages, opts);
    return out;
  });
}

export function askVisionDiag(env, prompt, imageUrl, opts = {}) {
  return diagWrap(env, async () => {
    const out = await askVision(env, prompt, imageUrl, opts);
    return out;
  });
}
// ------------------------------
// Convenience helpers used around the repo
// ------------------------------

export function buildMessagesFromText(text, system = "") {
  const msgs = [];
  if (system) msgs.push({ role: "system", content: system });
  msgs.push({ role: "user", content: text || "" });
  return msgs;
}

export function safeTrimAnswer(s, max = 3500) {
  const t = toTextFromAny(s).trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 20).trim() + "\n…(truncated)";
}

export function compactErrors(err) {
  const list = err?.errors || [];
  return lastN(list, 6)
    .map((x) => `${x.provider}:${x.model} -> ${x.message}`)
    .join("\n");
}