// src/lib/speechRouter.js
// STT-роутер Senti: Cloudflare Whisper → Gemini (inline audio) → OpenAI-compatible backend.
// Виправлення: коректні ендпоінти Gemini (v1 для 1.5-*), нормалізація назв моделей (-latest),
// авторетрай при 404, збереження попередньої логіки.

// ───────────── Helpers ─────────────
function bufToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function fetchWithType(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`stt: fetch ${r.status}`);
  const ct = r.headers.get("content-type") || "application/octet-stream";
  const ab = await r.arrayBuffer();
  return { ab, contentType: ct };
}
function guessLang(s = "") {
  const t = String(s || "").trim();
  if (!t) return null;
  const ua = /[їЇєЄіІґҐ]/;
  const cyr = /[А-Яа-яЁёЇїІіЄєҐґ]/;
  const de = /[ÄäÖöÜüß]/;
  const fr = /[À-ÿ]/;
  if (ua.test(t)) return "uk";
  if (cyr.test(t)) return "ru";
  if (de.test(t)) return "de";
  if (fr.test(t)) return "fr";
  return "en";
}

// ───────────── Cloudflare Whisper (@cf/openai/whisper) ─────────────
async function transcribeViaCloudflare(env, fileUrl) {
  const acc = env.CF_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!acc || !token) throw new Error("stt: cf creds missing");

  const { ab, contentType } = await fetchWithType(fileUrl);

  const form = new FormData();
  // ВАЖЛИВО: ключ має бути "audio", не "file"
  form.append("audio", new Blob([ab], { type: contentType || "audio/ogg" }), "voice");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/openai/whisper`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await r.json().catch(() => null);

  const text =
    data?.result?.text ||
    (Array.isArray(data?.result?.segments) ? data.result.segments.map(s => s?.text || "").join(" ") : "");

  if (!r.ok || !data?.success || !text) {
    const msg = data?.errors?.[0]?.message || data?.messages?.[0] || `cf http ${r.status}`;
    throw new Error(`stt: cf ${msg}`);
  }
  return { text: String(text).trim(), lang: guessLang(text) };
}

// ───────────── Gemini (inline audio) ─────────────
// Нормалізація назв моделей і вибір ендпойнта.
function normalizeGeminiModel(m) {
  let model = (m || "").trim() || "gemini-1.5-flash-latest";
  // Якщо вказано без -latest — додамо.
  if (/^gemini-1\.5-(pro|flash)(?:$|[^a-z])/i.test(model)) {
    if (!/-latest\b/i.test(model)) model = model.replace(/^(gemini-1\.5-(?:pro|flash)).*$/i, "$1-latest");
  }
  // Базовий дефолт
  if (!/^gemini-/.test(model)) model = "gemini-1.5-flash-latest";
  return model;
}
function geminiApiBaseFor(model) {
  // Для гілки 1.5-* — стабільний v1; інакше — v1beta для сумісності
  if (/^gemini-1\.5-/i.test(model)) return "https://generativelanguage.googleapis.com/v1";
  return "https://generativelanguage.googleapis.com/v1beta";
}

async function transcribeViaGeminiOnce({ key, model, fileUrl, apiBase }) {
  const { ab, contentType } = await fetchWithType(fileUrl);
  const b64 = bufToBase64(ab);

  const url = `${apiBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{
      parts: [
        { text: "Transcribe the following audio to plain text. Return only the transcript." },
        { inline_data: { data: b64, mime_type: contentType || "audio/ogg" } }
      ]
    }],
    generationConfig: { temperature: 0.0 }
  };

  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p?.text || "").join("").trim();

  if (!r.ok || !text) {
    const err = data?.error?.message || `gemini http ${r.status}`;
    const e = new Error(`stt: gemini ${err}`);
    e.status = r.status;
    throw e;
  }
  return { text, lang: guessLang(text) };
}

async function transcribeViaGemini(env, fileUrl) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY;
  if (!key) throw new Error("stt: gemini key missing");

  // 1) нормалізуємо модель
  const configured = normalizeGeminiModel(env.GEMINI_STT_MODEL);
  let model = configured;
  let apiBase = geminiApiBaseFor(model);

  try {
    return await transcribeViaGeminiOnce({ key, model, fileUrl, apiBase });
  } catch (e) {
    // Якщо 404 (як на твоєму скріні) — пробуємо альтернативи автоматично
    const is404 = (e && (e.status === 404 || /(^| )404( |$)/.test(String(e.message))));
    if (!is404) throw e;

    // Спроба №2: якщо стояв v1beta — перемкнемось на v1; якщо v1 — навпаки.
    apiBase = apiBase.includes("/v1beta") ? "https://generativelanguage.googleapis.com/v1" : "https://generativelanguage.googleapis.com/v1beta";
    try {
      return await transcribeViaGeminiOnce({ key, model, fileUrl, apiBase });
    } catch {}

    // Спроба №3: безпечна модель за замовчуванням (flash-latest) на v1
    try {
      model = "gemini-1.5-flash-latest";
      apiBase = "https://generativelanguage.googleapis.com/v1";
      return await transcribeViaGeminiOnce({ key, model, fileUrl, apiBase });
    } catch (e2) {
      throw e2; // віддамо останню помилку вгору
    }
  }
}

// ───────────── OpenAI-compatible (FREE / OpenRouter) ─────────────
async function transcribeViaOpenAICompat({ baseUrl, apiKey, model, fileUrl, extraHeaders = {} }) {
  if (!baseUrl) throw new Error("stt: compat baseUrl missing");

  const { ab, contentType } = await fetchWithType(fileUrl);
  const form = new FormData();
  form.append("file", new Blob([ab], { type: contentType || "audio/ogg" }), "voice.ogg");
  form.append("model", model || "whisper-1");

  const r = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/audio/transcriptions", {
    method: "POST",
    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), ...extraHeaders },
    body: form,
  });
  const data = await r.json().catch(() => null);
  const text = data?.text || data?.result || data?.transcription || "";
  if (!r.ok || !text) {
    const msg = data?.error?.message || data?.message || `http ${r.status}`;
    throw new Error(`stt: openai-compat ${msg}`);
  }
  return { text: String(text).trim(), lang: guessLang(text) };
}

// ───────────── Main router ─────────────
export async function transcribeVoice(env, fileUrl) {
  const errors = [];

  // 1) Cloudflare Whisper — швидкий, безкоштовний
  try { return await transcribeViaCloudflare(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 2) Gemini (inline audio) — з авто-ретраями по версіях/моделях
  try { return await transcribeViaGemini(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 3) OpenRouter або власний OpenAI-compatible бекенд
  if (env.OPENROUTER_API_KEY) {
    try {
      return await transcribeViaOpenAICompat({
        baseUrl: "https://openrouter.ai/api",
        apiKey: env.OPENROUTER_API_KEY,
        model: "openai/whisper-large-v3",
        fileUrl,
        extraHeaders: {
          "HTTP-Referer": env.OPENROUTER_SITE || "https://senti.bot",
          "X-Title": "Senti Bot",
        },
      });
    } catch (e) { errors.push(String(e?.message || e)); }
  }
  if (env.FREE_STT_BASE_URL) {
    try {
      return await transcribeViaOpenAICompat({
        baseUrl: env.FREE_STT_BASE_URL,
        apiKey: env.FREE_STT_API_KEY || "",
        model: env.FREE_STT_MODEL || "whisper-1",
        fileUrl,
      });
    } catch (e) { errors.push(String(e?.message || e)); }
  }

  throw new Error("STT providers failed | " + errors.join(" ; "));
}
