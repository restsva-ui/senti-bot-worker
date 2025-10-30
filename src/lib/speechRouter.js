// src/lib/speechRouter.js
// STT router: Cloudflare Whisper → Gemini (inline audio) → OpenAI-compatible (OpenRouter / FREE).
// Фікси: CF "file"↔"audio" + .ogg MIME; Gemini v1/v1beta, -latest↔без -latest, MIME opus; охайні повідомлення.

function bufToBase64(ab) {
  const b = new Uint8Array(ab); let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
async function fetchWithType(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`stt: fetch ${r.status}`);
  const ct = r.headers.get("content-type") || "application/octet-stream";
  const ab = await r.arrayBuffer();
  return { ab, contentType: ct };
}
function forceOgg(ct) {
  // Телеграм voice зазвичай віддає octet-stream; примусимо до коректного типу
  if (!ct || /octet-stream/i.test(ct)) return "audio/ogg; codecs=opus";
  if (/audio\/ogg/i.test(ct) && !/codecs/i.test(ct)) return "audio/ogg; codecs=opus";
  return ct;
}
function guessLang(s = "") {
  const t = String(s || "");
  if (/[їЇєЄіІґҐ]/.test(t)) return "uk";
  if (/[А-Яа-яЁёЇїІіЄєҐґ]/.test(t)) return "ru";
  if (/[ÄäÖöÜüß]/.test(t)) return "de";
  if (/[À-ÿ]/.test(t)) return "fr";
  return "en";
}

/* ── Cloudflare Whisper (@cf/openai/whisper) ─────────────────────────────── */
async function cfWhisperOnce({ acc, token, fileUrl, fieldName }) {
  const { ab, contentType } = await fetchWithType(fileUrl);
  const ct = forceOgg(contentType);
  const form = new FormData();
  form.append(fieldName, new Blob([ab], { type: ct }), "voice.ogg");
  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/openai/whisper`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await r.json().catch(() => null);

  const text =
    data?.result?.text ||
    (Array.isArray(data?.result?.segments) ? data.result.segments.map(s => s?.text || "").join(" ") : "");

  if (!r.ok || !data?.success || !text) {
    const msg = data?.errors?.[0]?.message || data?.messages?.[0] || `cf http ${r.status}`;
    const e = new Error(`stt: cf ${msg}`); e.status = r.status; throw e;
  }
  return { text: String(text).trim(), lang: guessLang(text) };
}

async function transcribeViaCloudflare(env, fileUrl) {
  const acc = env.CF_ACCOUNT_ID, token = env.CLOUDFLARE_API_TOKEN;
  if (!acc || !token) throw new Error("stt: cf creds missing");
  // 1) спроба з полем "file"
  try { return await cfWhisperOnce({ acc, token, fileUrl, fieldName: "file" }); }
  catch (e) {
    // 2) якщо 4xx/invalid audio — ретрай з "audio"
    if ((e && e.status && e.status < 500) || /invalid audio/i.test(String(e.message))) {
      return await cfWhisperOnce({ acc, token, fileUrl, fieldName: "audio" });
    }
    throw e;
  }
}

/* ── Gemini (inline audio → text) ────────────────────────────────────────── */
function normGeminiModel(m) {
  let model = (m || "").trim();
  if (!model) model = "gemini-1.5-flash";
  // якщо задано 1.5 pro/flash — спершу пробуємо з -latest
  if (/^gemini-1\.5-(pro|flash)\b/i.test(model) && !/-latest\b/i.test(model)) model += "-latest";
  if (!/^gemini-/.test(model)) model = "gemini-1.5-flash-latest";
  return model;
}
function geminiBaseFor(model) {
  return /^gemini-1\.5-/i.test(model)
    ? "https://generativelanguage.googleapis.com/v1"
    : "https://generativelanguage.googleapis.com/v1beta";
}
async function geminiOnce({ key, model, fileUrl, apiBase }) {
  const { ab, contentType } = await fetchWithType(fileUrl);
  const ct = forceOgg(contentType);
  const b64 = bufToBase64(ab);

  const url = `${apiBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{
      parts: [
        { text: "Transcribe the following audio to plain text. Return only the transcript." },
        { inline_data: { data: b64, mime_type: ct } }
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

  // 1) конфіг/дефолт
  let model = normGeminiModel(env.GEMINI_STT_MODEL);
  let base = geminiBaseFor(model);

  // a) configured (…-latest)
  try { return await geminiOnce({ key, model, fileUrl, apiBase: base }); }
  catch (e1) {
    // b) поміняти v1↔v1beta
    const altBase = base.includes("/v1beta") ? "https://generativelanguage.googleapis.com/v1"
                                             : "https://generativelanguage.googleapis.com/v1beta";
    try { return await geminiOnce({ key, model, fileUrl, apiBase: altBase }); }
    catch (e2) {
      // c) якщо модель із -latest — спробуємо без -latest на v1
      if (/-latest\b/i.test(model)) {
        try {
          const m2 = model.replace(/-latest\b/i, "");
          return await geminiOnce({ key, model: m2, fileUrl, apiBase: "https://generativelanguage.googleapis.com/v1" });
        } catch (e3) { /* fallthrough */ }
      }
      // d) безпечний дефолт (без -latest) на v1
      const safe = "gemini-1.5-flash";
      return await geminiOnce({ key, model: safe, fileUrl, apiBase: "https://generativelanguage.googleapis.com/v1" });
    }
  }
}

/* ── OpenAI-compatible (OpenRouter / власний FREE) ───────────────────────── */
async function transcribeViaOpenAICompat({ baseUrl, apiKey, model, fileUrl, extraHeaders = {} }) {
  if (!baseUrl) throw new Error("stt: compat baseUrl missing");
  const { ab, contentType } = await fetchWithType(fileUrl);
  const ct = forceOgg(contentType);
  const form = new FormData();
  form.append("file", new Blob([ab], { type: ct }), "voice.ogg");
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

/* ── Main ─────────────────────────────────────────────────────────────────── */
export async function transcribeVoice(env, fileUrl) {
  const errors = [];

  // 1) Cloudflare (найдешевше/швидко)
  try { return await transcribeViaCloudflare(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 2) Gemini (inline audio)
  try { return await transcribeViaGemini(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 3) OpenRouter
  if (env.OPENROUTER_API_KEY) {
    try {
      return await transcribeViaOpenAICompat({
        baseUrl: "https://openrouter.ai/api",
        apiKey: env.OPENROUTER_API_KEY,
        model: "openai/whisper-large-v3",
        fileUrl,
        extraHeaders: {
          "HTTP-Referer": env.OPENROUTER_SITE_URL || env.OPENROUTER_SITE || "https://senti.restsva.app",
          "X-Title": env.OPENROUTER_APP_NAME || "Senti Bot Worker",
        },
      });
    } catch (e) { errors.push(String(e?.message || e)); }
  }

  // 4) Власний FREE STT (якщо є)
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
