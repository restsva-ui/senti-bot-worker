// src/lib/modelRouter.js
// Узагальнений маршрутизатор моделей + health-метрики.
// ВАЖЛИВО: systemHint завжди додається. Якщо API не має поля system —
// підмішуємо як префікс до user-повідомлення.
// Додано: askVision() з каскадом Gemini → Cloudflare Workers AI (vision).

const HEALTH_NS = "ai:health";
const ALPHA = 0.3; // EWMA коеф.
const SLOW_MS = 4500; // поріг "повільно"

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

function nowMs() { return Date.now(); }
async function jsonSafe(r) {
  try { return await r.json(); } catch { return null; }
}
function withSystemPrefix(systemHint, userPrompt) {
  const s = (systemHint || "").trim();
  if (!s) return String(userPrompt || "");
  return `[SYSTEM]\n${s}\n\n[USER]\n${String(userPrompt || "")}`;
}
function pickKV(env) {
  return env.STATE_KV || env.CHECKLIST_KV || env.ENERGY_LOG_KV || env.LEARN_QUEUE_KV;
}
function hkey(provider, model) {
  return `${HEALTH_NS}:${provider}:${model}`;
}
async function updateHealth(env, { provider, model, ms, ok }) {
  const kv = pickKV(env);
  if (!kv) return;
  const key = hkey(provider, model);
  let prev = null;
  try { prev = JSON.parse((await kv.get(key, "text")) || "null"); } catch {}
  const ewmaMs = prev?.ewmaMs != null ? (ALPHA * ms + (1 - ALPHA) * prev.ewmaMs) : ms;
  const failStreak = ok ? 0 : (prev?.failStreak || 0) + 1;
  const data = { ewmaMs, failStreak, lastTs: new Date().toISOString() };
  try { await kv.put(key, JSON.stringify(data)); } catch {}
}
function parseEntry(raw) {
  // Підтримувані форми:
  // - "gemini:gemini-2.5-flash"
  // - "cf:@cf/meta/llama-3.1-8b-instruct" або просто "@cf/meta/llama-3.1-8b-instruct"
  // - "openrouter:deepseek/deepseek-chat"
  // - "free:meta-llama/llama-4-scout:free" або просто "free"
  const s = String(raw || "").trim();
  if (!s) return null;

  if (s.startsWith("@cf/")) return { provider: "cf", model: s };
  const m = s.split(":");
  if (m.length >= 2) {
    const provider = m[0].trim();
    const model = m.slice(1).join(":").trim();
    return { provider, model };
  }
  // якщо явно не вказано — вважаємо, що це openrouter-модель (вигляд a/b)
  if (s.includes("/")) return { provider: "openrouter", model: s };
  return { provider: "free", model: s };
}

// Невеличкі утиліти для vision
function isDataUrl(s = "") { return /^data:/.test(String(s || "")); }
function bufToBase64(bytes) {
  // безпечне кодування великого буфера у base64
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
async function ensureInlineImage(image, fallbackMime = "image/jpeg") {
  // Приймаємо або data: URL, або http(s)-URL; повертаємо data:URL для обох провайдерів
  if (!image) return null;
  const s = String(image);
  if (isDataUrl(s)) return s;

  if (/^https?:\/\//i.test(s)) {
    const r = await fetch(s);
    if (!r.ok) throw new Error(`image fetch http ${r.status}`);
    const arr = new Uint8Array(await r.arrayBuffer());
    const mime = r.headers.get("content-type") || fallbackMime;
    const b64 = bufToBase64(arr);
    return `data:${mime};base64,${b64}`;
  }
  // Якщо прилетів нестандартний тип — просимо конвертувати до http(s)/data:
  throw new Error("Unsupported image input; pass data:URL or http(s) URL");
}

// ─────────────────────────────────────────────────────────────────────────────
// Провайдери — текст

async function callGemini(env, model, prompt, systemHint) {
  const key =
    env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY;
  if (!key) throw new Error("GEMINI key missing");

  const user = withSystemPrefix(systemHint, prompt);

  // generateContent (v1beta)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
    key
  )}`;
  const body = {
    contents: [
      { role: "user", parts: [{ text: user }] },
    ],
    safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await jsonSafe(r);
  if (!r.ok) throw new Error(`gemini ${r.status} ${data?.error?.message || ""}`);
  const text =
    data?.candidates?.[0]?.content?.parts?.map(p => p?.text).filter(Boolean).join("\n").trim() ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  if (!text) throw new Error("gemini: empty response");
  return text.trim();
}

async function callCF(env, model, prompt, systemHint) {
  // 🔧 Тепер з фолбеками назв
  const token =
    env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || env.CLOUDFLARE_TOKEN;
  const acc =
    env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || env.ACCOUNT_ID;

  if (!token || !acc) throw new Error("Cloudflare credentials missing");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${encodeURIComponent(model)}`;
  const messages = [];
  if (systemHint?.trim()) messages.push({ role: "system", content: systemHint.trim() });
  messages.push({ role: "user", content: prompt });

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ messages }),
  });
  const data = await jsonSafe(r);
  if (!r.ok || !data?.success) {
    const msg = data?.errors?.[0]?.message || `cf http ${r.status}`;
    throw new Error(msg);
  }
  const out =
    data?.result?.response?.trim?.() ||
    data?.result?.text?.trim?.() ||
    data?.result?.output_text?.trim?.() ||
    "";
  if (!out) throw new Error("cf: empty response");
  return out.trim();
}

async function callOpenRouter(env, model, prompt, systemHint) {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OpenRouter key missing");

  const url = "https://openrouter.ai/api/v1/chat/completions";
  const messages = [];
  if (systemHint?.trim()) messages.push({ role: "system", content: systemHint.trim() });
  messages.push({ role: "user", content: String(prompt || "") });

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.6,
    }),
  });
  const data = await jsonSafe(r);
  const txt = data?.choices?.[0]?.message?.content || "";
  if (!r.ok || !txt) {
    const err = data?.error?.message || data?.message || `http ${r.status}`;
    throw new Error(`openrouter: ${err}`);
  }
  return txt.trim();
}

async function callFree(env, model, prompt, systemHint) {
  const base =
    env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL || "";
  if (!base) throw new Error("FREE base url missing");

  const key =
    env.FREE_LLM_API_KEY || env.FREE_API_KEY || "";
  const endpoint = base.replace(/\/+$/, "") + "/v1/chat/completions";

  const messages = [];
  if (systemHint?.trim()) messages.push({ role: "system", content: systemHint.trim() });
  messages.push({ role: "user", content: String(prompt || "") });

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {} ),
    },
    body: JSON.stringify({
      model: model || env.FREE_LLM_MODEL || "gpt-3.5-turbo",
      messages,
      temperature: 0.6,
    }),
  });
  const data = await jsonSafe(r);
  const txt = data?.choices?.[0]?.message?.content || "";
  if (!r.ok || !txt) {
    const err = data?.error?.message || data?.message || `http ${r.status}`;
    throw new Error(`free: ${err}`);
  }
  return txt.trim();
}
// ─────────────────────────────────────────────────────────────────────────────
/** Провайдери — VISION */

// Gemini vision (REST, v1beta generateContent)
// images: масив data:URL або http(s) URL (ми всередині перетворимо у data:)
async function callGeminiVision(env, model, { prompt, images = [], systemHint }) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY;
  if (!key) throw new Error("GEMINI key missing");

  const parts = [];
  const textPrompt = withSystemPrefix(systemHint, prompt || "Describe the image briefly.");
  parts.push({ text: textPrompt });

  // До 4 зображень
  const maxImg = Math.min(4, images.length || 0);
  for (let i = 0; i < maxImg; i++) {
    const dataUrl = await ensureInlineImage(images[i]);
    const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (!m) continue;
    const mimeType = m[1] || "image/jpeg";
    const data = m[2] || "";
    parts.push({ inline_data: { mime_type: mimeType, data } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role: "user", parts }],
    safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await jsonSafe(r);
  if (!r.ok) throw new Error(`gemini-vision ${r.status} ${data?.error?.message || ""}`);

  const out =
    data?.candidates?.[0]?.content?.parts?.map(p => p?.text).filter(Boolean).join("\n").trim() ||
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  if (!out) throw new Error("gemini-vision: empty response");
  return out.trim();
}

// CF: one-time license agree (silent)
async function ensureCFVisionAgreed({ accountId, token, model }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "agree" }),
    });
  } catch {}
}

// Cloudflare Workers AI vision (@cf/*-vision-instruct)
// ВАЖЛИВО: image_url має бути у вигляді { url: "data:..." }
async function callCFVision(env, model, { prompt, images = [], systemHint }) {
  const token =
    env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || env.CLOUDFLARE_TOKEN;
  const acc =
    env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || env.ACCOUNT_ID;

  if (!token || !acc) throw new Error("Cloudflare credentials missing");

  // тихий agree
  await ensureCFVisionAgreed({ accountId: acc, token, model });

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${encodeURIComponent(model)}`;

  const img = images[0];
  if (!img) throw new Error("No image provided");

  // конвертуємо у data:
  const dataUrl = await ensureInlineImage(img);

  const content = [];
  const fullPrompt = withSystemPrefix(systemHint, prompt || "Describe the image briefly.");
  content.push({ type: "input_text", text: fullPrompt });
  content.push({ type: "input_image", image_url: { url: dataUrl } });

  const messages = [{ role: "user", content }];

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ messages }),
  });
  const data = await jsonSafe(r);
  if (!r.ok || !data?.success) {
    const msg = data?.errors?.[0]?.message || `cf-vision http ${r.status}`;
    throw new Error(msg);
  }
  const out =
    data?.result?.response?.trim?.() ||
    data?.result?.text?.trim?.() ||
    data?.result?.output_text?.trim?.() ||
    "";
  if (!out) throw new Error("cf-vision: empty response");
  return out.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Головна точка: послідовний перебір за modelOrder (TEXT)

export async function askAnyModel(env, modelOrder, prompt, { systemHint } = {}) {
  const entries = String(modelOrder || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (!entries.length) {
    // Якщо порядок не задано — спробуємо мінімальний FREE як запасний варіант
    const p = withSystemPrefix(systemHint, prompt);
    return await callFree(env, env.FREE_LLM_MODEL || "gpt-3.5-turbo", p, "");
  }

  let lastErr = null;

  for (const raw of entries) {
    const ent = parseEntry(raw);
    if (!ent) continue;
    const { provider, model } = ent;

    const t0 = nowMs();
    try {
      let out;
      if (provider === "gemini") out = await callGemini(env, model, prompt, systemHint);
      else if (provider === "cf") out = await callCF(env, model, prompt, systemHint);
      else if (provider === "openrouter") out = await callOpenRouter(env, model, prompt, systemHint);
      else if (provider === "free") out = await callFree(env, model, prompt, systemHint);
      else {
        // невідомий провайдер — пробуємо як Free (OpenAI-сумісний)
        out = await callFree(env, model, prompt, systemHint);
      }
      const ms = nowMs() - t0;
      updateHealth(env, { provider, model, ms, ok: true }).catch(() => {});
      return out;
    } catch (e) {
      const ms = nowMs() - t0;
      updateHealth(env, { provider, model, ms, ok: false }).catch(() => {});
      lastErr = e;
      continue; // пробуємо наступний
    }
  }

  throw lastErr || new Error("All providers failed");
}

// ─────────────────────────────────────────────────────────────────────────────
// НОВЕ: Vision-каскад (Gemini → Cloudflare). Безкоштовно, з фолбеком.

export async function askVision(env, { prompt, images = [], systemHint } = {}) {
  // Порядок можна задати через ENV або використовуємо дефолт:
  // 1) Gemini (gemini-2.5-flash або gemini-1.5-flash)
  // 2) Cloudflare (@cf/meta/llama-3.2-11b-vision-instruct)
  const order = [
    { provider: "gemini-vision", model: env.GEMINI_MODEL_VISION || "gemini-2.5-flash" },
    { provider: "cf-vision",     model: env.CF_VISION_MODEL     || "@cf/meta/llama-3.2-11b-vision-instruct" },
  ];

  let lastErr = null;

  for (const ent of order) {
    const { provider, model } = ent;
    const t0 = nowMs();
    try {
      let out;
      if (provider === "gemini-vision") {
        const prepared = [];
        for (const img of images || []) prepared.push(await ensureInlineImage(img));
        out = await callGeminiVision(env, model, { prompt, images: prepared, systemHint });
      } else if (provider === "cf-vision") {
        out = await callCFVision(env, model, { prompt, images, systemHint });
      } else {
        throw new Error(`unknown vision provider: ${provider}`);
      }
      const ms = nowMs() - t0;
      updateHealth(env, { provider, model, ms, ok: true }).catch(() => {});
      return out;
    } catch (e) {
      const ms = nowMs() - t0;
      updateHealth(env, { provider, model, ms, ok: false }).catch(() => {});
      lastErr = e;
      continue; // м’який фолбек на наступного
    }
  }

  throw lastErr || new Error("All vision providers failed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Health summary для /admin

export async function getAiHealthSummary(env, entriesRaw) {
  const entries = (entriesRaw || []).map(parseEntry).filter(Boolean);
  const kv = pickKV(env);
  const out = [];

  for (const ent of entries) {
    const key = hkey(ent.provider, ent.model);
    let rec = null;
    try { rec = kv ? JSON.parse((await kv.get(key, "text")) || "null") : null; } catch {}
    const ewmaMs = rec?.ewmaMs || null;
    const slow = ewmaMs != null ? ewmaMs > SLOW_MS : false;
    const cool = rec?.failStreak >= 3; // якщо >=3 підряд помилок — червоне світло
    out.push({
      provider: ent.provider,
      model: ent.model,
      ewmaMs,
      failStreak: rec?.failStreak || 0,
      lastTs: rec?.lastTs || null,
      slow,
      cool,
    });
  }

  return out;
}
