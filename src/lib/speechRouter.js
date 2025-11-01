// src/lib/speechRouter.js
// STT router v3.8 — Cloudflare-safe, без проблемних діапазонів у RegExp.
// Каскад: Cloudflare Whisper → Gemini → OpenAI-compatible (OpenRouter/FREE)
// Повертає: { text, lang }

function bufToBase64(ab) {
  const b = new Uint8Array(ab);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

/* ───────────── Language guess (UA / RU / EN / DE / FR) ─────────────
   Уникаємо сирих кириличних діапазонів, використовуємо Unicode-escape + /u.
*/
export function guessLang(s = "") {
  const t = String(s || "");

  // Унікальні для української: ї (0457), є (0454), і (0456), ґ (0491) + їхні великі
  if (/[ \u0457\u0454\u0456\u0491\u0407\u0404\u0406\u0490]/u.test(t)) return "uk";

  // Будь-яка кирилиця → ru (як запасний варіант, якщо не впіймали uk)
  if (/\p{Script=Cyrillic}/u.test(t)) return "ru";

  // Німецькі діакритики або типові стоп-слова
  if (/[\u00C4\u00D6\u00DC\u00E4\u00F6\u00FC\u00DF]/u.test(t) || /\b(der|die|das|und|nicht|ich|mit|für)\b/i.test(t)) {
    return "de";
  }

  // Французькі діакритики або типові стоп-слова
  if (/[\u00E0\u00E2\u00E7\u00E9\u00E8\u00EA\u00EB\u00EE\u00EF\u00F4\u00F9\u00FB\u00FC\u00FF\u0153\u00E6]/u.test(t) ||
      /\b(le|la|les|des|une|et|pour|avec)\b/i.test(t)) {
    return "fr";
  }

  return "en";
}

/* ───────────── Audio helpers ───────────── */
function sniffAudioType(u8) {
  if (!u8 || u8.length < 8) return "";
  // OGG (Opus)
  if (u8[0] === 0x4f && u8[1] === 0x67 && u8[2] === 0x67 && u8[3] === 0x53) return "audio/ogg; codecs=opus";
  // MP3 (ID3 або MPEG frame)
  if ((u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) || (u8[0] === 0xff && (u8[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  // MP4 / M4A
  if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) return "audio/mp4";
  return "";
}

function normalizeMime(ct, u8, forced = "") {
  if (forced) return forced;
  let t = (ct || "").toLowerCase();
  const sniff = sniffAudioType(u8);
  if (!t || /octet-stream/.test(t)) t = sniff || "audio/ogg";
  if (/audio\/ogg/.test(t) && !/codecs=/.test(t) && sniff === "audio/ogg; codecs=opus") {
    t = "audio/ogg; codecs=opus";
  }
  return t;
}

async function fetchWithType(url, env) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`stt: fetch ${r.status}`);
  const ab = await r.arrayBuffer();
  const u8 = new Uint8Array(ab);
  const forced = String(env?.FORCE_AUDIO_TYPE || "").trim();
  const contentType = normalizeMime(r.headers.get("content-type"), u8, forced);
  return { ab, u8, contentType };
}

function isVeryShortAudio(u8) {
  // ~0.5–1.0 s для opus voice — пропускаємо CF Whisper, одразу фолбек
  return !u8 || u8.length < 4000;
}

/* ───────────── OpenAI-compat (OpenRouter / FREE) ───────────── */
async function transcribeViaOpenAICompat({ baseUrl, apiKey, model, fileUrl, env, extraHeaders = {} }) {
  const { ab, contentType } = await fetchWithType(fileUrl, env);
  const form = new FormData();
  form.append("file", new Blob([ab], { type: contentType }), "voice.ogg");
  form.append("model", model || "whisper-1");

  const r = await fetch(String(baseUrl).replace(/\/+$/, "") + "/v1/audio/transcriptions", {
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

/* ───────────── Cloudflare Whisper ───────────── */
async function cfWhisperOnce({ acc, token, fileUrl, env, fieldName, mimeVariant }) {
  const { ab, u8, contentType } = await fetchWithType(fileUrl, env);

  if (isVeryShortAudio(u8)) {
    const e = new Error("stt: cf short-audio, skip to gemini");
    e.skip = true;
    throw e;
  }

  const ct = mimeVariant === "ogg-only"
    ? "audio/ogg"
    : (mimeVariant === "opus" ? "audio/ogg; codecs=opus" : contentType);

  const form = new FormData();
  form.append(fieldName, new Blob([ab], { type: ct }), "voice.ogg");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/openai/whisper`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await r.json().catch(() => null);
  const text = data?.result?.text ||
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

  try {
    return await cfWhisperOnce({ acc, token, fileUrl, env, fieldName: "file", mimeVariant: "auto" });
  } catch (e1) {
    if (e1?.skip) throw e1;
    try {
      return await cfWhisperOnce({ acc, token, fileUrl, env, fieldName: "file", mimeVariant: "ogg-only" });
    } catch (e2) {
      if (e2?.skip || (e2 && e2.status && e2.status < 500) || /invalid audio/i.test(String(e2.message))) {
        const e = new Error("stt: cf invalid, fallback to gemini"); e.skip = true; throw e;
      }
      throw e2;
    }
  }
}

/* ───────────── Gemini (v1beta) ───────────── */
function pickGeminiModel(env) {
  const envModel = String(env?.GEMINI_STT_MODEL || "").trim();
  return envModel || "gemini-2.0-flash-exp";
}
function geminiBase() { return "https://generativelanguage.googleapis.com/v1beta"; }

async function transcribeViaGemini(env, fileUrl) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY;
  if (!key) throw new Error("stt: gemini key missing");
  const model = pickGeminiModel(env);

  const { ab, contentType } = await fetchWithType(fileUrl, env);
  const b64 = bufToBase64(ab);

  const url = `${geminiBase()}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{
      parts: [
        { text: "Transcribe the audio to plain text. Return only the transcript without metadata." },
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
    throw new Error(`stt: gemini ${err}`);
  }
  return { text, lang: guessLang(text) };
}

/* ───────────── Public API ───────────── */
export async function transcribeVoice(env, fileUrl) {
  const errors = [];

  // 1) Cloudflare Whisper
  try { return await transcribeViaCloudflare(env, fileUrl); }
  catch (e) {
    errors.push(String(e?.message || e));
    if (e?.skip) { /* одразу фолбек */ }
  }

  // 2) Gemini
  try { return await transcribeViaGemini(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 3) OpenRouter / FREE (OpenAI-compatible)
  if (env.OPENROUTER_API_KEY) {
    try {
      return await transcribeViaOpenAICompat({
        baseUrl: "https://openrouter.ai/api",
        apiKey:  env.OPENROUTER_API_KEY,
        model:   "openai/whisper-large-v3",
        fileUrl, env,
        extraHeaders: {
          "HTTP-Referer": env.OPENROUTER_SITE_URL || "https://senti.restsva.app",
          "X-Title":      env.OPENROUTER_APP_NAME || "Senti Bot Worker",
        }
      });
    } catch (e) { errors.push(String(e?.message || e)); }
  }
  if (env.FREE_STT_BASE_URL) {
    try {
      return await transcribeViaOpenAICompat({
        baseUrl:  env.FREE_STT_BASE_URL,
        apiKey:   env.FREE_STT_API_KEY || "",
        model:    env.FREE_STT_MODEL || "whisper-1",
        fileUrl,  env
      });
    } catch (e) { errors.push(String(e?.message || e)); }
  }

  throw new Error("STT providers failed | " + errors.join(" ; "));
}