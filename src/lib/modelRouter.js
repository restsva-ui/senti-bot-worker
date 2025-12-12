// src/lib/modelRouter.js
// Router для LLM/Vision провайдерів: Gemini / Cloudflare Workers AI / OpenRouter
// - єдине місце, де визначається пріоритет моделей (черга)
// - акуратний фолбек при помилках
// - детальна diag-інфа в err.errors + (опційно) через diagWrap

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanModelNameForGemini(model) {
  const raw = String(model || "").trim();
  if (!raw) return "";
  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

function extractSystemAndChat(messages) {
  const sys = [];
  const chat = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.role === "system") sys.push(String(m?.content || ""));
    else chat.push({ role: m?.role || "user", content: String(m?.content || "") });
  }
  return { systemText: sys.join("\n").trim(), chat };
}

function guessMimeFromHeaders(ct) {
  const s = String(ct || "").toLowerCase();
  if (s.includes("image/png")) return "image/png";
  if (s.includes("image/webp")) return "image/webp";
  if (s.includes("image/gif")) return "image/gif";
  if (s.includes("image/jpg") || s.includes("image/jpeg")) return "image/jpeg";
  return "image/jpeg";
}

async function fetchImageAsInlineData(imageUrl) {
  if (!imageUrl) return null;
  const url = String(imageUrl);
  if (!/^https?:\/\//i.test(url)) return null;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Image fetch failed HTTP ${resp.status}`);

  const mimeType = guessMimeFromHeaders(resp.headers.get("content-type"));
  const buf = await resp.arrayBuffer();

  // base64 (без Buffer, щоб не залежати від nodejs_compat)
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(bin);

  return { mimeType, data: b64 };
}

// ------------------------------
// Gemini (Text + Vision)
// ------------------------------

async function callGemini({ env, messages, model, temperature = 0.5, imageUrl = null }) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const { systemText, chat } = extractSystemAndChat(messages);

  const raw = String(model || env.GEMINI_MODEL || "gemini-1.5-flash").trim();
  const baseModel = cleanModelNameForGemini(raw) || "gemini-1.5-flash";

  const candidates = [];
  const push = (m) => {
    if (m && !candidates.includes(m)) candidates.push(m);
  };

  push(baseModel);
  if (!/-(\d{3}|latest)$/.test(baseModel)) push(`${baseModel}-latest`);
  push("gemini-1.5-flash-latest");
  push("gemini-1.5-pro-latest");

  // Build Gemini contents
  // For vision: we attach inlineData image in the first user message.
  let inline = null;
  if (imageUrl) {
    inline = await fetchImageAsInlineData(imageUrl);
  }

  const contents = (chat.length ? chat : [{ role: "user", content: "" }]).map((m, idx) => {
    const role = m.role === "assistant" ? "model" : "user";
    const parts = [];

    // first user message gets the image (if present)
    if (inline && idx === 0 && role === "user") {
      parts.push({ inlineData: { mimeType: inline.mimeType, data: inline.data } });
    }

    parts.push({ text: m.content || "" });
    return { role, parts };
  });

  const body = {
    contents,
    generationConfig: { temperature },
  };

  // systemInstruction supported in v1 (and in many v1beta builds)
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const tryOne = async (apiVersion, m) => {
    const url =
      `https://generativelanguage.googleapis.com/${apiVersion}/models/` +
      `${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;

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
      err.data = data;
      throw err;
    }

    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("") || "";

    return text.trim();
  };

  let lastErr;

  for (const apiVersion of ["v1", "v1beta"]) {
    for (const m of candidates) {
      try {
        return await tryOne(apiVersion, m);
      } catch (e) {
        lastErr = e;

        const s = Number(e?.status || 0);
        const msg = String(e?.message || "");
        const aliasish = s === 404 || /not found|is not found|model/i.test(msg);
        const transient = s === 429 || s === 500 || s === 503;

        // Fail fast for auth/quota/permission
        if (s === 401 || s === 403) throw e;

        // Slight backoff on rate limits
        if (s === 429) await sleep(250);

        if (!(aliasish || transient)) throw e;
      }
    }
  }

  throw lastErr || new Error("Gemini call failed");
}

// ------------------------------
// Cloudflare Workers AI (REST or Binding)
// ------------------------------

async function callCfAi({ env, messages, model, temperature = 0.5 }) {
  // 1) Preferred: REST via CLOUDFLARE_API_TOKEN + CF_ACCOUNT_ID
  const apiToken = env.CLOUDFLARE_API_TOKEN;
  const accountId = env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || env.account_id;

  if (apiToken && accountId) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      accountId
    )}/ai/run/${encodeURIComponent(model)}`;

    // CF AI expects { messages:[{role,content}], temperature?... } for chat-like models
    const body = {
      messages: (Array.isArray(messages) ? messages : []).map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature,
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg =
        data?.errors?.[0]?.message ||
        data?.error?.message ||
        `Cloudflare AI HTTP ${resp.status}`;
      const err = new Error(msg);
      err.status = resp.status;
      err.data = data;
      throw err;
    }

    // typical: { result: { response: "..." } } OR { result: "..." }
    const out = data?.result?.response ?? data?.result ?? "";
    return String(out || "").trim();
  }

  // 2) Fallback: binding env.AI (only if you set it in wrangler.toml bindings)
  if (env?.AI) {
    const prompt = (Array.isArray(messages) ? messages : [])
      .map((m) => `${m.role === "assistant" ? "Assistant" : m.role === "system" ? "System" : "User"}: ${m.content}`)
      .join("\n");

    const res = await env.AI.run(model, { prompt, temperature });
    return (res?.response ?? res ?? "").toString().trim();
  }

  // If neither exists, it's not configured.
  throw new Error("Cloudflare AI not configured (need CLOUDFLARE_API_TOKEN+CF_ACCOUNT_ID or env.AI binding)");
}

// ------------------------------
// OpenRouter
// ------------------------------

async function callOpenRouter({ env, messages, model, temperature = 0.5 }) {
  const apiKey = env.OPENROUTER_API_KEY || env.FREE_API_KEY || env.FREE_LLM_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  const baseUrl = (env.FREE_API_BASE_URL || env.FREE_LLM_BASE_URL || "https://openrouter.ai/api").replace(
    /\/$/,
    ""
  );
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
    messages: (Array.isArray(messages) ? messages : []).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error?.message || data?.error || `OpenRouter HTTP ${resp.status}`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  const text = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || "";
  return String(text).trim();
}

// ------------------------------
// Public API
// ------------------------------

export async function askAnyModel(env, messages, opts = {}) {
  const kind = opts.kind || "text";
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.5;

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
        status: Number(e?.status || 0) || undefined,
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
  const temperature = typeof opts.temperature === "number" ? opts.temperature : 0.2;

  const order = pickOrder(env, "vision");
  if (!order.length) throw new Error("MODEL_ORDER_VISION is empty");

  const messages = [{ role: "user", content: prompt || "Describe the image." }];

  const errors = [];

  for (const entry of order) {
    const { provider, model } = normalizeProviderEntry(entry);

    try {
      if (provider === "gemini") {
        const out = await callGemini({
          env,
          messages,
          model,
          temperature,
          imageUrl,
        });
        return out;
      }

      if (provider === "cf") {
        // CF vision через REST: imageUrl має бути доступний з CF (публічний або тимчасовий TG URL)
        // Якщо imageUrl приватний — краще Gemini inlineData (вище) або зробити проксі-ендпойнт.
        const out = await callCfAi({
          env,
          messages: [
            {
              role: "user",
              content: `${prompt || "Describe the image."}\nImage URL: ${imageUrl}`,
            },
          ],
          model,
          temperature,
        });
        return out;
      }

      if (provider === "openrouter" || provider === "free") {
        const out = await callOpenRouter({
          env,
          messages: [
            {
              role: "user",
              content: `${prompt || "Describe the image."}\nImage URL: ${imageUrl}`,
            },
          ],
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
        status: Number(e?.status || 0) || undefined,
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