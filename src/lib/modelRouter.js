// src/lib/modelRouter.js
// Узагальнений маршрутизатор моделей + health-метрики + мультирежими (text/vision/stt/tts).
// ВАЖЛИВО: systemHint завжди додається. Якщо API не має поля system —
// підмішуємо як префікс до user-повідомлення.

const HEALTH_NS = "ai:health";
const ALPHA = 0.3; // EWMA коеф.
const SLOW_MS = 4500; // поріг "повільно"
const DEFAULT_TIMEOUT_MS = 25000;

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
  const data = {
    ewmaMs,
    failStreak,
    lastTs: new Date().toISOString(),
    lastOk: !!ok,
  };
  try { await kv.put(key, JSON.stringify(data)); } catch {}
}

function normalizeProvider(p) {
  const v = String(p || "").trim().toLowerCase();
  if (!v) return "free";
  if (v === "cf" || v === "cloudflare") return "cf";
  if (v === "gemini" || v === "google") return "gemini";
  if (v === "openrouter" || v === "or") return "openrouter";
  if (v === "free") return "free";
  return v;
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
    const provider = normalizeProvider(m[0]);
    const model = m.slice(1).join(":").trim();
    return { provider, model };
  }

  // якщо явно не вказано — вважаємо, що це openrouter-модель (вигляд a/b)
  if (s.includes("/")) return { provider: "openrouter", model: s };

  // "free" або щось без "/" → free
  return { provider: "free", model: s };
}

// Розпізнавання режиму за опціями
function detectMode(opts = {}) {
  if (opts?.ttsText) return "tts";               // text -> audio
  if (opts?.audioBase64) return "stt";           // audio -> text
  if (opts?.imageBase64) return "vision";        // image -> text
  return "text";                                 // text -> text (у т.ч. код)
}

function makeAbort(timeoutMs = DEFAULT_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => {
    try { ctrl.abort("timeout"); } catch {}
  }, timeoutMs);
  return { ctrl, clear: () => clearTimeout(t) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Провайдери — текст/vision/stt/tts

// GEMINI (text + vision)
async function callGemini(env, model, prompt, systemHint, opts = {}) {
  // Підтримка ключа як у твоєму воркері: GOOGLE_API_KEY
  const key =
    env.GOOGLE_API_KEY ||
    env.GEMINI_API_KEY ||
    env.GOOGLE_GEMINI_API_KEY ||
    env.GEMINI_KEY;

  if (!key) throw new Error("GEMINI key missing (set GOOGLE_API_KEY or GEMINI_API_KEY)");

  const mode = detectMode(opts);
  const user = withSystemPrefix(systemHint, prompt);

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(key)}`;

  const parts = [{ text: user }];
  if (mode === "vision" && opts.imageBase64) {
    parts.push({
      inline_data: { mime_type: opts.imageMime || "image/png", data: opts.imageBase64 },
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: opts.temperature ?? 0.2 },
    safetySettings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }],
  };

  const { ctrl, clear } = makeAbort(opts.timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await jsonSafe(r);
    if (!r.ok) throw new Error(`gemini ${r.status} ${data?.error?.message || ""}`.trim());

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join("\n").trim() ||
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "";

    if (!text) throw new Error("gemini: empty response");
    return String(text).trim();
  } finally {
    clear();
  }
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
    // CF vision: content = [{type:"input_text"},{type:"input_image", image: BASE64}]
    const textWithSystem = withSystemPrefix(systemHint, prompt);
    inputs = {
      messages: [
        {
          role: "user",
          content: [
            { type: "input_text", text: String(textWithSystem || "") },
            ...(opts.imageBase64 ? [{ type: "input_image", image: opts.imageBase64 }] : []),
          ],
        },
      ],
      temperature: opts.temperature ?? 0.2,
    };
  } else if (mode === "stt") {
    inputs = { audio: { buffer: opts.audioBase64, format: opts.audioFormat || "mp3" } };
  } else if (mode === "tts") {
    inputs = { text: opts.ttsText, voice: opts.voice || "male" };
  } else {
    const messages = [];
    if (systemHint?.trim()) messages.push({ role: "system", content: systemHint.trim() });
    messages.push({ role: "user", content: String(prompt || "") });
    inputs = { messages, temperature: opts.temperature ?? 0.2 };
  }

  const { ctrl, clear } = makeAbort(opts.timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(inputs),
    });

    const data = await jsonSafe(r);
    if (!r.ok || !data?.success) {
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

    const out =
      data?.result?.response?.trim?.() ||
      data?.result?.text?.trim?.() ||
      data?.result?.output_text?.trim?.() ||
      data?.result?.output?.text?.trim?.() ||
      data?.result?.result?.trim?.() ||
      "";

    if (!out) throw new Error("cf: empty response");
    return String(out).trim();
  } finally {
    clear();
  }
}

// OPENROUTER (text тільки)
async function callOpenRouter(env, model, prompt, systemHint, opts = {}) {
  const mode = detectMode(opts);
  if (mode !== "text") throw new Error("openrouter: unsupported mode for this call");

  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OpenRouter key missing");

  const url = "https://openrouter.ai/api/v1/chat/completions";
  const messages = [];
  if (systemHint?.trim()) messages.push({ role: "system", content: systemHint.trim() });
  messages.push({ role: "user", content: String(prompt || "") });

  const { ctrl, clear } = makeAbort(opts.timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...(env.OPENROUTER_SITE_URL ? { "HTTP-Referer": env.OPENROUTER_SITE_URL } : {}),
        ...(env.OPENROUTER_APP_NAME ? { "X-Title": env.OPENROUTER_APP_NAME } : {}),
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
    return String(txt).trim();
  } finally {
    clear();
  }
}

// FREE (OpenAI-сумісний endpoint; тільки text)
async function callFree(env, model, prompt, systemHint, opts = {}) {
  const mode = detectMode(opts);
  if (mode !== "text") throw new Error("free: unsupported mode for this call");

  const base = env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL || "";
  if (!base) throw new Error("FREE base url missing");

  // ключ може бути пустий (free), але підтримуємо
  const key = env.FREE_LLM_API_KEY || env.FREE_API_KEY || env.OPENROUTER_API_KEY || "";

  // ВАЖЛИВО: поважаємо FREE_API_PATH з wrangler.toml
  const path = env.FREE_API_PATH || "/v1/chat/completions";
  const endpoint = base.replace(/\/+$/, "") + (path.startsWith("/") ? path : `/${path}`);

  const messages = [];
  if (systemHint?.trim()) messages.push({ role: "system", content: systemHint.trim() });
  messages.push({ role: "user", content: String(prompt || "") });

  const { ctrl, clear } = makeAbort(opts.timeoutMs);
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({
        model: model || env.FREE_API_MODEL || env.FREE_LLM_MODEL || "gpt-3.5-turbo",
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
    return String(txt).trim();
  } finally {
    clear();
  }
}

// === PART 2 BELOW ===
// ─────────────────────────────────────────────────────────────────────────────
// Головна точка: послідовний перебір за modelOrder.
// Розширено: приймає опції режимів (imageBase64 / audioBase64 / ttsText / voice / temperature).

export async function askAnyModel(
  env,
  modelOrder,
  prompt,
  {
    systemHint,
    imageBase64,
    imageMime,
    audioBase64,
    audioFormat,
    ttsText,
    voice,
    temperature,
    timeoutMs,
  } = {}
) {
  const entries = String(modelOrder || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Якщо порядок не задано — мінімальний FREE як запасний варіант (text only)
  if (!entries.length) {
    const p = withSystemPrefix(systemHint, prompt);
    return await callFree(env, env.FREE_API_MODEL || env.FREE_LLM_MODEL || "gpt-3.5-turbo", p, "", {
      temperature,
      timeoutMs,
    });
  }

  const mode = detectMode({ imageBase64, audioBase64, ttsText });

  let lastErr = null;
  for (const raw of entries) {
    const ent = parseEntry(raw);
    if (!ent) continue;
    const provider = normalizeProvider(ent.provider);
    const model = ent.model;

    const t0 = nowMs();
    try {
      let out;

      if (provider === "gemini") {
        out = await callGemini(env, model, prompt, systemHint, {
          imageBase64,
          imageMime,
          temperature,
          timeoutMs,
        });
      } else if (provider === "cf") {
        out = await callCF(env, model, prompt, systemHint, {
          imageBase64,
          imageMime,
          audioBase64,
          audioFormat,
          ttsText,
          voice,
          temperature,
          timeoutMs,
        });
      } else if (provider === "openrouter") {
        if (mode !== "text") throw new Error("openrouter: only text mode supported here");
        out = await callOpenRouter(env, model, prompt, systemHint, { temperature, timeoutMs });
      } else if (provider === "free") {
        if (mode !== "text") throw new Error("free: only text mode supported here");
        out = await callFree(env, model, prompt, systemHint, { temperature, timeoutMs });
      } else {
        // невідомий провайдер — пробуємо як Free (text only)
        if (mode !== "text") throw new Error("unknown provider: only text mode fallback available");
        out = await callFree(env, model, prompt, systemHint, { temperature, timeoutMs });
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

  throw lastErr || new Error("All providers failed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Спеціалізовані “цукрові” функції

// text/code
export async function askText(env, modelOrder, prompt, { systemHint, temperature, timeoutMs } = {}) {
  return await askAnyModel(env, modelOrder, prompt, { systemHint, temperature, timeoutMs });
}

// vision: image(base64) + prompt → text
export async function askVision(
  env,
  modelOrder,
  prompt,
  { systemHint, imageBase64, imageMime = "image/png", temperature, timeoutMs } = {}
) {
  return await askAnyModel(env, modelOrder, prompt, { systemHint, imageBase64, imageMime, temperature, timeoutMs });
}

// stt: audio(base64) → transcript
export async function transcribe(
  env,
  modelOrder,
  { audioBase64, audioFormat = "mp3" },
  { systemHint, timeoutMs } = {}
) {
  return await askAnyModel(env, modelOrder, "(audio)", { systemHint, audioBase64, audioFormat, timeoutMs });
}

// tts: text → { audioBase64, format }
export async function speak(env, modelOrder, text, { voice = "male", systemHint, timeoutMs } = {}) {
  const out = await askAnyModel(env, modelOrder, "(tts)", { systemHint, ttsText: text, voice, timeoutMs });
  return out; // для TTS повертаємо об'єкт {audioBase64, format} з callCF
}

// ─────────────────────────────────────────────────────────────────────────────
// Health summary для /admin

export async function getAiHealthSummary(env, entriesRaw) {
  const entries = (entriesRaw || []).map(parseEntry).filter(Boolean);
  const kv = pickKV(env);
  const out = [];

  for (const ent of entries) {
    const provider = normalizeProvider(ent.provider);
    const key = hkey(provider, ent.model);
    let rec = null;
    try {
      rec = kv ? JSON.parse((await kv.get(key, "text")) || "null") : null;
    } catch {}

    const ewmaMs = rec?.ewmaMs || null;
    const slow = ewmaMs != null ? ewmaMs > SLOW_MS : false;
    const cool = (rec?.failStreak || 0) >= 3;

    out.push({
      provider,
      model: ent.model,
      ewmaMs,
      failStreak: rec?.failStreak || 0,
      lastTs: rec?.lastTs || null,
      slow,
      cool,
      lastOk: rec?.lastOk ?? null,
    });
  }

  return out;
}
