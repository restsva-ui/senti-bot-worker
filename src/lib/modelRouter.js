// Гнучкий роутер моделей із авто-fallback, діагностичними тегами та health-моніторингом.
// Провайдери: Gemini (v1→v1beta), OpenRouter, Cloudflare Workers AI, OpenAI-compatible (free).

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const isRetryable = (s) => RETRYABLE.has(Number(s || 0));

// ── Health monitor (STATE_KV) ────────────────────────────────────────────────
const HKEY = (id) => `ai_health:${id}`; // id = provider:model
const HEALTH_TTL_S = 24 * 60 * 60; // 24h
const COOLDOWN_MS = 15 * 60 * 1000; // 15 хв після серії помилок
const MAX_FAIL_STREAK = 3; // 3 підряд -> тимчасово скіпаємо
const EWMA_ALPHA = 0.2; // згладження латентності (0..1)

function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}
async function readHealth(env, id) {
  const raw = await ensureState(env).get(HKEY(id));
  if (!raw) return { ewmaMs: 0, lastOkTs: 0, lastErrTs: 0, failStreak: 0 };
  try { return JSON.parse(raw); } catch { return { ewmaMs: 0, lastOkTs: 0, lastErrTs: 0, failStreak: 0 }; }
}
async function writeHealth(env, id, h) {
  await ensureState(env).put(HKEY(id), JSON.stringify(h), { expirationTtl: HEALTH_TTL_S });
}
async function updateHealth(env, id, { ok, ms = 0, status = 0 }) {
  const h = await readHealth(env, id);
  const now = Date.now();
  if (ok) {
    h.ewmaMs = h.ewmaMs ? (EWMA_ALPHA * ms + (1 - EWMA_ALPHA) * h.ewmaMs) : ms;
    h.lastOkTs = now;
    h.failStreak = 0;
  } else {
    h.lastErrTs = now;
    h.failStreak = (h.failStreak || 0) + 1;
    if (ms > 0) h.ewmaMs = h.ewmaMs ? (EWMA_ALPHA * ms + (1 - EWMA_ALPHA) * h.ewmaMs) : ms;
    h.lastStatus = status || h.lastStatus || 0;
  }
  await writeHealth(env, id, h);
  return h;
}
async function shouldSkip(env, id) {
  const h = await readHealth(env, id);
  return h.failStreak >= MAX_FAIL_STREAK && (Date.now() - h.lastErrTs) < COOLDOWN_MS;
}
export async function getAiHealthSummary(env, orderList = []) {
  const items = [];
  for (const entry of orderList) {
    const [provider, ...rest] = entry.split(":");
    const model = rest.join(":");
    const id = `${provider}:${model}`;
    const h = await readHealth(env, id);
    const cool = h.failStreak >= MAX_FAIL_STREAK && Date.now() - h.lastErrTs < COOLDOWN_MS;
    const slow = h.ewmaMs > 2500; // маркер повільності
    items.push({ id, provider, model, ...h, cool, slow });
  }
  return items;
}

// ---- Утіліти ---------------------------------------------------------------

/** Діагностичний тег наприкінці відповіді */
function diagTag({ provider, model, ms, enabled }) {
  if (!enabled) return "";
  const pretty = [provider, model].filter(Boolean).join(" ");
  const t = typeof ms === "number" && isFinite(ms) ? ` • ${Math.round(ms)}ms` : "";
  return `\n\n[via ${pretty}${t}]`;
}

/** Нормалізація назв моделей Gemini до v1 */
function normalizeGemini(model) {
  const m = String(model || "").trim();
  return m
    .replace(/-latest$/i, "")      // gemini-2.5-flash-latest -> gemini-2.5-flash
    .replace(/^google\/|^gemini\//i, ""); // google/gemini-... -> gemini-...
}

/** Безпечний JSON.parse */
function safeJSON(x) {
  try { return JSON.parse(x); } catch { return {}; }
}

/** fetch із таймаутом */
async function fetchJSON(url, init = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    const text = await r.text();
    const json = safeJSON(text);
    return { ok: r.ok, status: r.status, json, raw: text, headers: r.headers };
  } finally {
    clearTimeout(id);
  }
}

// ---- Провайдери ------------------------------------------------------------

/**
 * Gemini: спочатку v1, при 404/NOT_FOUND автоматично пробує v1beta.
 * Повертає { text, provider, model, ms }.
 */
async function callGemini(env, model, prompt, opts = {}) {
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY missing");

  const mdl = normalizeGemini(model || env.GEMINI_MODEL || "gemini-2.5-flash");
  const system = opts.system ? String(opts.system) : "";
  const user = String(prompt || "");
  const body = {
    contents: [
      { role: "user", parts: [{ text: system ? `${system}\n\n${user}` : user }] },
    ],
    generationConfig: { temperature: opts.temperature ?? 0.4, maxOutputTokens: opts.max_tokens ?? 1024 },
  };

  const started = Date.now();
  let lastErr = null;

  for (const ver of ["v1", "v1beta"]) {
    const url = `https://generativelanguage.googleapis.com/${ver}/models/${encodeURIComponent(mdl)}:generateContent?key=${apiKey}`;
    const res = await fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const ms = Date.now() - started;

    if (res.ok) {
      const parts = res.json?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts)
        ? parts.map((p) => p?.text || "").join("")
        : res.json?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (text) {
        await updateHealth(env, `gemini:${mdl}`, { ok: true, ms });
        return { text, provider: "Gemini", model: mdl, ms };
      }
      lastErr = new Error(`gemini ${mdl} empty`);
      await updateHealth(env, `gemini:${mdl}`, { ok: false, ms, status: 500 });
      continue;
    }

    const status = res.status;
    const st = res.json?.error?.status || "";

    // якщо модель не знайдена у v1 — пробуємо v1beta
    if (status === 404 || st === "NOT_FOUND") {
      lastErr = new Error(`gemini ${mdl} ${ver} 404`);
      await updateHealth(env, `gemini:${mdl}`, { ok: false, ms, status });
      continue;
    }

    // інша помилка — зупиняємо
    const err = new Error(`gemini ${mdl} ${status}`);
    err.status = status; err.payload = res.json;
    await updateHealth(env, `gemini:${mdl}`, { ok: false, ms, status });
    throw err;
  }

  throw lastErr || new Error(`gemini ${mdl} failed`);
}

/**
 * OpenRouter chat completions.
 * Повертає { text, provider, model, ms }.
 */
async function callOpenRouter(env, model, prompt, opts = {}) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing");
  const mdl = model || env.OPENROUTER_MODEL || "deepseek/deepseek-chat";
  const started = Date.now();

  const res = await fetchJSON("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.SERVICE_HOST || "https://workers.dev",
      "X-Title": "SentiBot",
    },
    body: JSON.stringify({
      model: mdl,
      messages: [
        ...(opts.system ? [{ role: "system", content: String(opts.system) }] : []),
        { role: "user", content: String(prompt || "") },
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });

  const ms = Date.now() - started;

  if (!res.ok) {
    const err = new Error(`openrouter ${mdl} ${res.status}`);
    err.status = res.status; err.payload = res.json;
    await updateHealth(env, `openrouter:${mdl}`, { ok: false, ms, status: res.status });
    throw err;
  }

  const text =
    res.json?.choices?.[0]?.message?.content ??
    res.json?.choices?.[0]?.text ?? "";
  if (!text) {
    await updateHealth(env, `openrouter:${mdl}`, { ok: false, ms, status: 500 });
    throw new Error(`openrouter ${mdl} empty`);
  }

  await updateHealth(env, `openrouter:${mdl}`, { ok: true, ms });
  return { text, provider: "OpenRouter", model: mdl, ms };
}

/**
 * Cloudflare Workers AI.
 * Повертає { text, provider, model, ms }.
 */
async function callCloudflareAI(env, model, prompt, opts = {}) {
  const accountId = env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN;
  if (!accountId || !token) throw new Error("CF creds missing");

  const mdl = model || env.CF_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(mdl)}`;
  const started = Date.now();

  const res = await fetchJSON(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        ...(opts.system ? [{ role: "system", content: String(opts.system) }] : []),
        { role: "user", content: String(prompt || "") },
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });

  const ms = Date.now() - started;

  if (!res.ok || res.json?.success === false) {
    const status = res.status || 500;
    await updateHealth(env, `cf:${mdl}`, { ok: false, ms, status });
    const err = new Error(`cf ${mdl} ${status}`);
    err.status = status; err.payload = res.json;
    throw err;
  }

  const text =
    res.json?.result?.response ??
    res.json?.result?.choices?.[0]?.message?.content ??
    res.json?.result?.text ?? "";
  if (!text) {
    await updateHealth(env, `cf:${mdl}`, { ok: false, ms, status: 500 });
    throw new Error(`cf ${mdl} empty`);
  }

  await updateHealth(env, `cf:${mdl}`, { ok: true, ms });
  return { text, provider: "Cloudflare AI", model: mdl, ms };
}

/**
 * OpenAI-compatible endpoint (generic). Useful for free/community proxies or custom gateways.
 * Requires:
 *   FREE_API_BASE_URL (e.g. "https://api.openai.com")
 *   FREE_API_KEY
 *   FREE_API_PATH (optional, default "/v1/chat/completions")
 * Returns { text, provider, model, ms }.
 */
async function callOpenAICompat(env, model, prompt, opts = {}) {
  const base = (env.FREE_API_BASE_URL || "").replace(/\/$/, "");
  const key = env.FREE_API_KEY;
  const path = env.FREE_API_PATH || "/v1/chat/completions";
  if (!base || !key) throw new Error("FREE_API_BASE_URL / FREE_API_KEY missing");

  const mdl = model || env.FREE_API_MODEL || "gpt-3.5-turbo";
  const url = base + path;
  const started = Date.now();

  const res = await fetchJSON(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: mdl,
      messages: [
        ...(opts.system ? [{ role: "system", content: String(opts.system) }] : []),
        { role: "user", content: String(prompt || "") },
      ],
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.max_tokens ?? 1024,
    }),
  });

  const ms = Date.now() - started;

  if (!res.ok) {
    await updateHealth(env, `free:${mdl}`, { ok: false, ms, status: res.status });
    const err = new Error(`openai-compat ${mdl} ${res.status}`);
    err.status = res.status; err.payload = res.json;
    throw err;
  }

  const text =
    res.json?.choices?.[0]?.message?.content ??
    res.json?.choices?.[0]?.text ?? "";
  if (!text) {
    await updateHealth(env, `free:${mdl}`, { ok: false, ms, status: 500 });
    throw new Error(`openai-compat ${mdl} empty`);
  }

  await updateHealth(env, `free:${mdl}`, { ok: true, ms });
  return { text, provider: "FreeLLM", model: mdl, ms };
}

// ---- Публічний API ---------------------------------------------------------

/**
 * env.MODEL_ORDER — кома-розділений список з префіксами провайдерів:
 *   "gemini:<id>, cf:<id>, openrouter:<id>, free:<id>"
 * Повертає рядок відповіді (з діаг-тегом якщо DIAG_TAGS != "off").
 */
export async function askAnyModel(env, prompt, opts = {}) {
  const order = String(env.MODEL_ORDER || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (order.length === 0) throw new Error("MODEL_ORDER is empty");

  const showTag = String(env.DIAG_TAGS || "").toLowerCase() !== "off";

  let lastErr = null;

  // Перше коло: пропускаємо провайдери в cooldown
  for (const entry of order) {
    const [providerRaw, ...rest] = entry.split(":");
    const provider = providerRaw?.trim().toLowerCase();
    const model = rest.join(":");
    const id = `${provider}:${model}`;
    try {
      if (await shouldSkip(env, id)) continue;

      let result;
      if (provider === "gemini") result = await callGemini(env, model, prompt, opts);
      else if (provider === "openrouter") result = await callOpenRouter(env, model, prompt, opts);
      else if (provider === "cf") result = await callCloudflareAI(env, model, prompt, opts);
      else if (provider === "free" || provider === "openai") result = await callOpenAICompat(env, model, prompt, opts);
      else throw new Error(`Unknown provider: ${provider}`);

      return result.text + diagTag({ provider: result.provider, model: result.model, ms: result.ms, enabled: showTag });
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e.status)) { /* просто переходимо далі */ }
    }
  }

  // Друге коло: ігноруємо cooldown, намагаємося будь-що відповісти
  for (const entry of order) {
    const [providerRaw, ...rest] = entry.split(":");
    const provider = providerRaw?.trim().toLowerCase();
    const model = rest.join(":");
    try {
      let result;
      if (provider === "gemini") result = await callGemini(env, model, prompt, opts);
      else if (provider === "openrouter") result = await callOpenRouter(env, model, prompt, opts);
      else if (provider === "cf") result = await callCloudflareAI(env, model, prompt, opts);
      else if (provider === "free" || provider === "openai") result = await callOpenAICompat(env, model, prompt, opts);
      else continue;

      return result.text + diagTag({ provider: result.provider, model: result.model, ms: result.ms, enabled: showTag });
    } catch (e) { lastErr = e; }
  }

  throw lastErr || new Error("All models failed");
}

export { readHealth as _readHealth, updateHealth as _updateHealth };