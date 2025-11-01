// src/lib/speechRouter.js
// STT router v3.6
// ✔ Telegram voice → надійне визначення MIME + форс через ENV
// ✔ Cloudflare Whisper каскад (file/audio) + multi-MIME
// ✔ Gemini STT: ПЕРЕХІД на gemini-2.0-flash-exp (v1beta), з ретраями
// ✔ OpenRouter → FREE (OpenAI-compat) фолбек
// ✔ Автовизначення мови (uk/ru/en/de/fr)

/* ───────────── Utils ───────────── */
function bufToBase64(ab) {
  const b = new Uint8Array(ab); let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function guessLang(s = "") {
  const t = String(s || "");
  if (/[їЇєЄіІґҐ]/.test(t)) return "uk";
  if (/[А-Яа-яЁёЇїІіЄєҐґ]/.test(t)) return "ru";
  if (/[ÄäÖöÜüß]/.test(t)) return "de";
  if (/[À-ÿ]/.test(t)) return "fr";
  return "en";
}

/* ───────────── MIME helpers ───────────── */
function sniffAudioType(u8) {
  if (!u8 || u8.length < 8) return "";
  // OGG/Opus: "OggS"
  if (u8[0] === 0x4f && u8[1] === 0x67 && u8[2] === 0x67 && u8[3] === 0x53)
    return "audio/ogg; codecs=opus";
  // MP3: "ID3" або frame sync 0xFFEx
  if ((u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) ||
      (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0))
    return "audio/mpeg";
  // MP4/M4A: "ftyp"
  if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70)
    return "audio/mp4";
  return "";
}

function normalizeMime(ct, u8, forced = "") {
  if (forced) return forced; // жорстке форсування через ENV
  let t = (ct || "").toLowerCase();
  const sniff = sniffAudioType(u8);
  if (!t || /octet-stream/.test(t)) t = sniff || "audio/ogg; codecs=opus";
  if (/audio\/ogg/.test(t) && !/codecs=/.test(t)) t = "audio/ogg; codecs=opus";
  return t;
}

async function fetchWithType(url, env) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`stt: fetch ${r.status}`);
  const ab = await r.arrayBuffer();
  const u8 = new Uint8Array(ab);
  const forced = String(env?.FORCE_AUDIO_TYPE || "").trim();
  const headerCt = r.headers.get("content-type") || "";
  const contentType = normalizeMime(headerCt, u8, forced);
  return { ab, u8, contentType };
}

/* ───────────── OpenAI-compat (OpenRouter / FREE) ───────────── */
async function transcribeViaOpenAICompat({ baseUrl, apiKey, model, fileUrl, env, extraHeaders = {} }) {
  if (!baseUrl) throw new Error("stt: compat baseUrl missing");
  const { ab, contentType } = await fetchWithType(fileUrl, env);
  const form = new FormData();
  form.append("file", new Blob([ab], { type: contentType }), "voice.ogg");
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

/* ───────────── Cloudflare Whisper (@cf/openai/whisper) ───────────── */
async function cfWhisperOnce({ acc, token, fileUrl, env, fieldName, mimeVariant = "auto" }) {
  const { ab, contentType } = await fetchWithType(fileUrl, env);
  const ct = mimeVariant === "ogg-only"
    ? "audio/ogg"
    : mimeVariant === "opus"
      ? "audio/ogg; codecs=opus"
      : contentType;

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

  // 1) file + detected/forced MIME
  try { return await cfWhisperOnce({ acc, token, fileUrl, env, fieldName: "file", mimeVariant: "auto" }); }
  catch (e1) {
    // 2) file + "audio/ogg"
    try { return await cfWhisperOnce({ acc, token, fileUrl, env, fieldName: "file", mimeVariant: "ogg-only" }); }
    catch (e2) {
      // 3) audio + "audio/ogg; codecs=opus"
      if ((e2 && e2.status && e2.status < 500) || /invalid audio/i.test(String(e2.message))) {
        return await cfWhisperOnce({ acc, token, fileUrl, env, fieldName: "audio", mimeVariant: "opus" });
      }
      throw e2;
    }
  }
}

/* ───────────── Gemini (inline audio parts) ───────────── */
function normGeminiModel(m) {
  let model = (m || "").trim();
  // СТАНДАРТ: новий стабільний STT саме на 2.0-flash-exp
  if (!model) model = "gemini-2.0-flash-exp";
  // Будь-які старі 1.5 → на 2.0
  if (/^gemini-1\.5/i.test(model)) model = "gemini-2.0-flash-exp";
  // Прибрати -latest/-001, якщо раптом задали
  model = model.replace(/-latest\b/i, "").replace(/-001\b/i, "");
  return model;
}
function geminiBaseFor() {
  // gemini-2.0 обов’язково через v1beta
  return "https://generativelanguage.googleapis.com/v1beta";
}

async function geminiOnce({ key, model, fileUrl, apiBase, env }) {
  const { ab, contentType } = await fetchWithType(fileUrl, env);
  const b64 = bufToBase64(ab);
  const url = `${apiBase}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{
      parts: [
        { text: "Transcribe the audio to plain text. Return only the transcript." },
        { inline_data: { data: b64, mime_type: contentType } }
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

  let model = normGeminiModel(env.GEMINI_STT_MODEL);
  let base = geminiBaseFor(model);

  // base
  try { return await geminiOnce({ key, model, fileUrl, apiBase: base, env }); }
  catch (e1) {
    // альтернативні назви на той самий ендпойнт
    const alts = ["gemini-2.0-flash-exp", "gemini-2.0-flash"];
    for (const m of alts) {
      try { return await geminiOnce({ key, model: m, fileUrl, apiBase: base, env }); }
      catch (_) {}
    }
    // як крайній варіант — ще раз спроба через v1beta з 1.5-pro-001
    try { return await geminiOnce({ key, model: "gemini-1.5-pro-001", fileUrl, apiBase: base, env }); }
    catch (e2) { throw e2; }
  }
}

/* ───────────── Main router ───────────── */
export async function transcribeVoice(env, fileUrl) {
  const errors = [];

  // 1) Cloudflare (дешево/швидко)
  try { return await transcribeViaCloudflare(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 2) Gemini (inline, v1beta, 2.0-flash-exp)
  try { return await transcribeViaGemini(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 3) OpenRouter (якщо є ключ)
  if (env.OPENROUTER_API_KEY) {
    try {
      return await transcribeViaOpenAICompat({
        baseUrl: "https://openrouter.ai/api",
        apiKey: env.OPENROUTER_API_KEY,
        model: "openai/whisper-large-v3",
        fileUrl,
        env,
        extraHeaders: {
          "HTTP-Referer": env.OPENROUTER_SITE_URL || env.OPENROUTER_SITE || "https://senti.restsva.app",
          "X-Title": env.OPENROUTER_APP_NAME || "Senti Bot Worker",
        },
      });
    } catch (e) { errors.push(String(e?.message || e)); }
  }

  // 4) Власний FREE STT (опційно)
  if (env.FREE_STT_BASE_URL) {
    try {
      return await transcribeViaOpenAICompat({
        baseUrl: env.FREE_STT_BASE_URL,
        apiKey: env.FREE_STT_API_KEY || "",
        model: env.FREE_STT_MODEL || "whisper-1",
        fileUrl,
        env,
      });
    } catch (e) { errors.push(String(e?.message || e)); }
  }

  throw new Error("STT providers failed | " + errors.join(" ; "));
}