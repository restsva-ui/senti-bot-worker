// src/lib/speechRouter.js
// STT-роутер Senti: Cloudflare Whisper → Gemini (inline audio) → OpenAI-compatible backend.
// Фікси: CF форм-поле "file"⇄"audio" з авто-ретраєм; Gemini v1/v1beta + -latest нормалізація.

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
  const ua = /[їЇєЄіІґҐ]/, cyr = /[А-Яа-яЁёЇїІіЄєҐґ]/, de = /[ÄäÖöÜüß]/, fr = /[À-ÿ]/;
  if (ua.test(t)) return "uk";
  if (cyr.test(t)) return "ru";
  if (de.test(t)) return "de";
  if (fr.test(t)) return "fr";
  return "en";
}

/* ───────────── Cloudflare Whisper (@cf/openai/whisper) ───────────── */
async function cfWhisperOnce({ acc, token, fileUrl, fieldName }) {
  const { ab, contentType } = await fetchWithType(fileUrl);
  const form = new FormData();
  form.append(fieldName, new Blob([ab], { type: contentType || "audio/ogg" }), "voice");
  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/openai/whisper`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await r.json().catch(() => null);
  const text =
    data?.result?.text ||
    (Array.isArray(data?.result?.segments) ? data.result.segments.map(s => s?.text || "").join(" ") : "");
  if (!r.ok || !data?.success || !text) {
    const msg = data?.errors?.[0]?.message || data?.messages?.[0] || `cf http ${r.status}`;
    const e = new Error(`stt: cf ${msg}`);
    e.status = r.status;
    throw e;
  }
  return { text: String(text).trim(), lang: guessLang(text) };
}
async function transcribeViaCloudflare(env, fileUrl) {
  const acc = env.CF_ACCOUNT_ID, token = env.CLOUDFLARE_API_TOKEN;
  if (!acc || !token) throw new Error("stt: cf creds missing");
  // 1) спроба з "file"
  try { return await cfWhisperOnce({ acc, token, fileUrl, fieldName: "file" }); }
  catch (e) {
    // 2) якщо 4xx/invalid audio — пробуємо з "audio"
    if ((e && e.status && e.status < 500) || /invalid audio/i.test(String(e.message))) {
      return await cfWhisperOnce({ acc, token, fileUrl, fieldName: "audio" });
    }
    throw e;
  }
}

/* ───────────── Gemini (inline audio) ───────────── */
function normalizeGeminiModel(m) {
  let model = (m || "").trim() || "gemini-1.5-flash-latest";
  if (/^gemini-1\.5-(pro|flash)(?:$|[^a-z])/i.test(model) && !/-latest\b/i.test(model)) {
    model = model.replace(/^(gemini-1\.5-(?:pro|flash)).*$/i, "$1-latest");
  }
  if (!/^gemini-/.test(model)) model = "gemini-1.5-flash-latest";
  return model;
}
function geminiApiBaseFor(model) {
  return /^gemini-1\.5-/i.test(model)
    ? "https://generativelanguage.googleapis.com/v1"
    : "https://generativelanguage.googleapis.com/v1beta";
}
async function geminiOnce({ key, model, fileUrl, apiBase }) {
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
    const e = new Error(`stt: gemini ${err}`); e.status = r.status; throw e;
  }
  return { text, lang: guessLang(text) };
}
async function transcribeViaGemini(env, fileUrl) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY;
  if (!key) throw new Error("stt: gemini key missing");
  let model = normalizeGeminiModel(env.GEMINI_STT_MODEL);
  let base = geminiApiBaseFor(model);

  try { return await geminiOnce({ key, model, fileUrl, apiBase: base }); }
  catch (e1) {
    // 404/модель не знайдено → міняємо версію/модель і пробуємо ще.
    const is404 = (e1 && (e1.status === 404 || /(^| )404( |$)/.test(String(e1.message))));
    if (!is404) throw e1;
    // спроба 2: інший base (v1 <-> v1beta)
    base = base.includes("/v1beta") ? "https://generativelanguage.googleapis.com/v1" : "https://generativelanguage.googleapis.com/v1beta";
    try { return await geminiOnce({ key, model, fileUrl, apiBase: base }); }
    catch (e2) {
      // спроба 3: дефолтна модель на v1
      try {
        model = "gemini-1.5-flash-latest";
        base = "https://generativelanguage.googleapis.com/v1";
        return await geminiOnce({ key, model, fileUrl, apiBase: base });
      } catch (e3) { throw e3; }
    }
  }
}

/* ───────────── OpenAI-compatible (FREE/OpenRouter) ───────────── */
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

/* ───────────── Main router ───────────── */
export async function transcribeVoice(env, fileUrl) {
  const errors = [];
  try { return await transcribeViaCloudflare(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }
  try { return await transcribeViaGemini(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

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
