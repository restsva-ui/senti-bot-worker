// src/lib/modelRouter.js
// Узагальнений маршрутизатор моделей + health-метрики + мультирежими (text/vision/stt/tts).
// ВАЖЛИВО: systemHint завжди додається. Якщо API не має поля system —
// підмішуємо як префікс до user-повідомлення.

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
  // - "cf:@cf/meta/llama-3.2-11b-instruct" або просто "@cf/meta/llama-3.2-11b-instruct"
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

// Розпізнавання режиму за опціями
function detectMode(opts = {}) {
  if (opts?.ttsText) return "tts";               // text -> audio
  if (opts?.audioBase64) return "stt";           // audio -> text
  if (opts?.imageBase64) return "vision";        // image -> text
  return "text";                                 // text -> text (у т.ч. код)
}

// ─────────────────────────────────────────────────────────────────────────────
// Провайдери — текст/vision/stt/tts

// GEMINI (text + vision)
async function callGemini(env, model, prompt, systemHint, opts = {}) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY;
  if (!key) throw new Error("GEMINI key missing");

  const mode = detectMode(opts);
  const user = withSystemPrefix(systemHint, prompt);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  // parts: text + (опціонально) inline image
  const parts = [{ text: user }];
  if (mode === "vision" && opts.imageBase64) {
    // За замовчуванням припускаємо PNG; змінюй mime_type за потреби.
    parts.push({
      inline_data: { mime_type: opts.imageMime || "image/png", data: opts.imageBase64 }
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: opts.temperature ?? 0.2 },
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

// CLOUDFLARE WORKERS AI (chat/vision/stt/tts)
async function callCF(env, model, prompt, systemHint, opts = {}) {
  const token = env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN;
  const acc = env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !acc) throw new Error("Cloudflare credentials missing");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${encodeURIComponent(model)}`;
  const mode = detectMode(opts);

  let inputs;
  if (mode === "vision") {
    // CF vision формат: content = [{type:"input_text"},{type:"input_image", image: BASE64}]
    inputs = {
      messages: [{
        role: "user",
        content: [
          { type: "input_text", text: String(prompt || "") },
          ...(opts.imageBase64 ? [{ type: "input_image", image: opts.imageBase64 }] : [])
        ]
      }],
      temperature: opts.temperature ?? 0.2
    };
  } else if (mode === "stt") {
    inputs = {
      audio: { buffer: opts.audioBase64, format: opts.audioFormat || "mp3" }
    };
  } else if (mode === "tts") {
    inputs = { text: opts.ttsText, voice: opts.voice || "male" };
  } else {
    // text/chat
    const messages = [];
    if (systemHint?.trim()) messages.push({ role: "system", content: systemHint.trim() });
    messages.push({ role: "user", content: String(prompt || "") });
    inputs = { messages, temperature: opts.temperature ?? 0.2 };
  }

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(inputs),
  });

  const data = await jsonSafe(r);
  if (!data?.success) {
    const msg = data?.errors?.[0]?.message || `cf http ${r.status}`;
    throw new Error(msg);
  }

  // Нормалізуємо вихід
  if (mode === "tts") {
    const res = data?.result || {};
    const audioBase64 = res?.audio ?? res?.output?.audio ?? res?.result ?? null;
    const format = res?.format ?? res?.output?.format ?? "mp3";
    if (!audioBase64) throw new Error("cf tts: no audio");
    return { audioBase64, format };
  }

  if (mode === "stt") {
    const res = data?.result || {};
    const text = res?.text ?? res?.transcript ?? res?.response ?? res?.result ?? "";
    if (!text) throw new Error("cf stt: empty transcript");
    return String(text).trim();
  }

  // text / vision → текст
  const out =
    data?.result?.response?.trim?.() ||
    data?.result?.text?.trim?.() ||
    data?.result?.output_text?.trim?.() ||
    data?.result?.output?.text?.trim?.() ||
    data?.result?.result?.trim?.() ||
    "";

  if (!out) throw new Error("cf: empty response");
  return out.trim();
}

// OPENROUTER (text тільки; якщо vision/stt/tts — пропускаємо)
async function callOpenRouter(env, model, prompt, systemHint, opts = {}) {
  const mode = detectMode(opts);
  if (mode !== "text") throw new Error("openrouter: unsupported mode for this call");

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
      temperature: opts.temperature ?? 0.6,
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

// FREE (OpenAI-сумісний endpoint; тільки text)
async function callFree(env, model, prompt, systemHint, opts = {}) {
  const mode = detectMode(opts);
  if (mode !== "text") throw new Error("free: unsupported mode for this call");

  const base = env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL || "";
  if (!base) throw new Error("FREE base url missing");
  const key = env.FREE_LLM_API_KEY || env.FREE_API_KEY || "";
  const endpoint = base.replace(/\/+$/, "") + "/v1/chat/completions";

  const messages = [];
  if (systemHint?.trim()) messages.push({ role: "system", content: systemHint.trim() });
  messages.push({ role: "user", content: String(prompt || "") });

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({
      model: model || env.FREE_LLM_MODEL || "gpt-3.5-turbo",
      messages,
      temperature: opts.temperature ?? 0.6,
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
// Головна точка: послідовний перебір за modelOrder.
// Розширено: тепер приймає опції режимів (imageBase64 / audioBase64 / ttsText / voice / temperature).

export async function askAnyModel(env, modelOrder, prompt, { systemHint, imageBase64, imageMime, audioBase64, audioFormat, ttsText, voice, temperature } = {}) {
  const entries = String(modelOrder || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  // Якщо порядок не задано — спробуємо мінімальний FREE як запасний варіант (text only)
  if (!entries.length) {
    const p = withSystemPrefix(systemHint, prompt);
    return await callFree(env, env.FREE_LLM_MODEL || "gpt-3.5-turbo", p, "", { temperature });
  }

  const mode = detectMode({ imageBase64, audioBase64, ttsText });

  let lastErr = null;
  for (const raw of entries) {
    const ent = parseEntry(raw);
    if (!ent) continue;
    const { provider, model } = ent;

    const t0 = nowMs();
    try {
      let out;
      if (provider === "gemini") {
        // Gemini підтримує text і vision (inline_data)
        out = await callGemini(env, model, prompt, systemHint, { imageBase64, imageMime, temperature });
      } else if (provider === "cf") {
        // CF підтримує text/vision/stt/tts
        out = await callCF(env, model, prompt, systemHint, { imageBase64, imageMime, audioBase64, audioFormat, ttsText, voice, temperature });
      } else if (provider === "openrouter") {
        if (mode !== "text") throw new Error("openrouter: only text mode supported here");
        out = await callOpenRouter(env, model, prompt, systemHint, { temperature });
      } else if (provider === "free") {
        if (mode !== "text") throw new Error("free: only text mode supported here");
        out = await callFree(env, model, prompt, systemHint, { temperature });
      } else {
        // невідомий провайдер — пробуємо як Free (text only)
        if (mode !== "text") throw new Error("unknown provider: only text mode fallback available");
        out = await callFree(env, model, prompt, systemHint, { temperature });
      }

      const ms = nowMs() - t0;
      updateHealth(env, { provider, model, ms, ok: true }).catch(() => {});
      return out;
    } catch (e) {
      const ms = nowMs() - t0;
      updateHealth(env, { provider, model, ms, ok: false }).catch(() => {});
      lastErr = e;
      continue; // пробуємо наступний у ланцюжку
    }
  }

  // Якщо усі впали — кидаємо останню помилку
  throw lastErr || new Error("All providers failed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Спеціалізовані “цукрові” функції для зручності інтеграції

// text/code
export async function askText(env, modelOrder, prompt, { systemHint, temperature } = {}) {
  return await askAnyModel(env, modelOrder, prompt, { systemHint, temperature });
}

// vision: image(base64) + prompt → text
export async function askVision(env, modelOrder, prompt, { systemHint, imageBase64, imageMime = "image/png", temperature } = {}) {
  return await askAnyModel(env, modelOrder, prompt, { systemHint, imageBase64, imageMime, temperature });
}

// stt: audio(base64) → transcript
export async function transcribe(env, modelOrder, { audioBase64, audioFormat = "mp3" }, { systemHint } = {}) {
  return await askAnyModel(env, modelOrder, "(audio)", { systemHint, audioBase64, audioFormat });
}

// tts: text → { audioBase64, format }
export async function speak(env, modelOrder, text, { voice = "male", systemHint } = {}) {
  const out = await askAnyModel(env, modelOrder, "(tts)", { systemHint, ttsText: text, voice });
  // для TTS ми повертаємо об'єкт {audioBase64, format} з callCF
  return out;
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