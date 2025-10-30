// src/lib/speechRouter.js
// STT router v3.1 — порядок: Cloudflare Whisper → Gemini → OpenAI-compatible (OpenRouter/FREE).
// Фікси:
//  • Форсимо MIME для телеграм-voice -> "audio/ogg; codecs=opus"
//  • Ретрай Cloudflare з полями file/audio
//  • Gemini: нормалізація моделі, fallback на flash-latest, перемикання v1/v1beta
//  • Стабільні повідомлення про помилки й легкий дебаг через console.log
//  • Маленька пауза між провайдерами, щоб уникати 405/429

/********************** helpers **************************/
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function bufToBase64(ab) {
  const b = new Uint8Array(ab);
  let s = "";
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
  // Telegram voice часто приходить як octet-stream; Whisper/CF очікує ogg/opus.
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

/********************** Cloudflare Whisper **************************/
// Є дві валідні назви поля: "file" або "audio". Пробуємо обидві.
async function cfWhisperOnce({ acc, token, fileUrl, fieldName }) {
  const { ab, contentType } = await fetchWithType(fileUrl);
  const ct = forceOgg(contentType);

  const form = new FormData();
  form.append(fieldName, new Blob([ab], { type: ct }), "voice.ogg");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/openai/whisper`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const data = await r.json().catch(() => null);

  const text =
    data?.result?.text ||
    (Array.isArray(data?.result?.segments)
      ? data.result.segments.map((s) => s?.text || "").join(" ")
      : "");

  if (!r.ok || !data?.success || !text) {
    const msg = data?.errors?.[0]?.message || data?.messages?.[0] || `cf http ${r.status}`;
    const e = new Error(`stt: cf ${msg}`);
    e.status = r.status;
    throw e;
  }

  return { text: String(text).trim(), lang: guessLang(text) };
}

async function transcribeViaCloudflare(env, fileUrl) {
  const acc = env.CF_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!acc || !token) throw new Error("stt: cf creds missing");

  try {
    const res = await cfWhisperOnce({ acc, token, fileUrl, fieldName: "file" });
    console.log("STT ✅ Cloudflare (file)");
    return res;
  } catch (e) {
    if ((e && e.status && e.status < 500) || /invalid audio/i.test(String(e?.message || ""))) {
      const res2 = await cfWhisperOnce({ acc, token, fileUrl, fieldName: "audio" });
      console.log("STT ✅ Cloudflare (audio)");
      return res2;
    }
    throw e;
  }
}

/********************** Gemini **************************/
function normGeminiModel(m) {
  let model = (m || "").trim();
  // дефолт — flash-latest
  if (!model) model = "gemini-1.5-flash-latest";
  // якщо вказали 1.5 pro/flash без -latest — додаємо
  if (/^gemini-1\.5-(pro|flash)\b/i.test(model) && !/-latest\b/i.test(model)) model += "-latest";
  // будь-що інше не з "gemini-" -> замінимо на flash-latest
  if (!/^gemini-/.test(model)) model = "gemini-1.5-flash-latest";
  return model;
}

function geminiBaseFor(model) {
  // 1.5 сімейство зазвичай працює на v1, але бувають регіональні розбіжності — спробуємо v1 і v1beta
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
    contents: [
      {
        parts: [
          { text: "Transcribe the audio to plain text. Return only the transcript." },
          { inline_data: { data: b64, mime_type: ct } },
        ],
      },
    ],
    generationConfig: { temperature: 0.0 },
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("").trim();

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

  let model = normGeminiModel(env.GEMINI_STT_MODEL);
  let base = geminiBaseFor(model);

  try {
    const res = await geminiOnce({ key, model, fileUrl, apiBase: base });
    console.log(`STT ✅ Gemini (${model} @ ${base.includes("/v1beta") ? "v1beta" : "v1"})`);
    return res;
  } catch (e1) {
    // v1 <-> v1beta
    const altBase = base.includes("/v1beta")
      ? "https://generativelanguage.googleapis.com/v1"
      : "https://generativelanguage.googleapis.com/v1beta";
    try {
      const res2 = await geminiOnce({ key, model, fileUrl, apiBase: altBase });
      console.log(`STT ✅ Gemini (${model} @ alt ${altBase.includes("/v1beta") ? "v1beta" : "v1"})`);
      return res2;
    } catch (e2) {
      // якщо це -latest і впирається в 404/unsupported — спробуємо без -latest на v1
      if (/-latest\b/i.test(model)) {
        try {
          const m2 = model.replace(/-latest\b/i, "");
          const res3 = await geminiOnce({
            key,
            model: m2,
            fileUrl,
            apiBase: "https://generativelanguage.googleapis.com/v1",
          });
          console.log(`STT ✅ Gemini fallback (${m2})`);
          return res3;
        } catch {}
      }
      // остаточний безпечний fallback
      const safe = "gemini-1.5-flash-latest";
      const res4 = await geminiOnce({
        key,
        model: safe,
        fileUrl,
        apiBase: "https://generativelanguage.googleapis.com/v1",
      });
      console.log(`STT ✅ Gemini safe (${safe})`);
      return res4;
    }
  }
}
/********************** OpenAI-compatible (OpenRouter / FREE) ****************/
async function transcribeViaOpenAICompat({ baseUrl, apiKey, model, fileUrl, extraHeaders = {} }) {
  if (!baseUrl) throw new Error("stt: compat baseUrl missing");
  const { ab, contentType } = await fetchWithType(fileUrl);
  const ct = forceOgg(contentType);

  const form = new FormData();
  form.append("file", new Blob([ab], { type: ct }), "voice.ogg");
  form.append("model", model || "whisper-1");

  const r = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...extraHeaders,
    },
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

/**************************** Main entry *************************************/
export async function transcribeVoice(env, fileUrl) {
  const errors = [];

  // 1) Cloudflare (швидко/дешево)
  try {
    const res = await transcribeViaCloudflare(env, fileUrl);
    return res;
  } catch (e) {
    errors.push(String(e?.message || e));
  }

  await sleep(50);

  // 2) Gemini (inline audio)
  try {
    const res = await transcribeViaGemini(env, fileUrl);
    return res;
  } catch (e) {
    errors.push(String(e?.message || e));
  }

  await sleep(50);

  // 3) OpenRouter (або власний FREE сумісний з OpenAI)
  // 3a) OpenRouter
  if (env.OPENROUTER_API_KEY) {
    try {
      const res = await transcribeViaOpenAICompat({
        baseUrl: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api",
        apiKey: env.OPENROUTER_API_KEY,
        model: "openai/whisper-large-v3",
        fileUrl,
        extraHeaders: {
          "HTTP-Referer": env.OPENROUTER_SITE_URL || env.OPENROUTER_SITE || "https://senti.restsva.app",
          "X-Title": env.OPENROUTER_APP_NAME || "Senti Bot Worker",
        },
      });
      console.log("STT ✅ OpenRouter");
      return res;
    } catch (e) {
      errors.push(String(e?.message || e));
    }
  }

  // 3b) FREE OpenAI-compatible (опційно)
  if (env.FREE_STT_BASE_URL) {
    try {
      const res = await transcribeViaOpenAICompat({
        baseUrl: env.FREE_STT_BASE_URL,
        apiKey: env.FREE_STT_API_KEY || "",
        model: env.FREE_STT_MODEL || "whisper-1",
        fileUrl,
      });
      console.log("STT ✅ FREE compat");
      return res;
    } catch (e) {
      errors.push(String(e?.message || e));
    }
  }

  // якщо нічого не спрацювало
  throw new Error("STT providers failed | " + errors.join(" ; "));
}
