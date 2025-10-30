// src/lib/speechRouter.js
// Універсальний STT-роутер для Senti.
// Ланцюжок: Cloudflare Whisper → Gemini (inline audio) → OpenAI-compatible FREE STT.
// Повертає { text, lang? }.
//
// ВАЖЛИВО: для Cloudflare Whisper поле форм-дати має називатись "audio" (не "file").
// Помилка "Invalid or incomplete input for the model" зазвичай означає неправильне ім'я поля або ломані bytes.

function bufToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa працює у Workers для бінарних рядків
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

/* ───────────────── Cloudflare Whisper (@cf/openai/whisper) ───────────────── */
async function transcribeViaCloudflare(env, fileUrl) {
  const acc = env.CF_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!acc || !token) throw new Error("stt: cf creds missing");

  const { ab, contentType } = await fetchWithType(fileUrl);

  const form = new FormData();
  // ключ ВАЖЛИВО: "audio"
  form.append("audio", new Blob([ab], { type: contentType || "audio/ogg" }), "voice");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/openai/whisper`;
  const r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await r.json().catch(() => null);

  // Успішна відповідь: { result: { text: "...", segments?: [...] }, success: true }
  const text =
    data?.result?.text ||
    (Array.isArray(data?.result?.segments) ? data.result.segments.map(s => s?.text || "").join(" ") : "");

  if (!r.ok || !data?.success || !text) {
    const msg = data?.errors?.[0]?.message || data?.messages?.[0] || `cf http ${r.status}`;
    throw new Error(`stt: cf ${msg}`);
  }
  return { text: String(text).trim(), lang: guessLang(text) };
}

/* ───────────────────────── Gemini (inline audio) ──────────────────────────── */
async function transcribeViaGemini(env, fileUrl) {
  const key = env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY;
  if (!key) throw new Error("stt: gemini key missing");

  const model = env.GEMINI_STT_MODEL || "gemini-1.5-flash"; // підтримує аудіопарти
  const { ab, contentType } = await fetchWithType(fileUrl);
  const b64 = bufToBase64(ab);

  // Один запит generateContent з аудіо-партом
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
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
    const msg = data?.error?.message || `gemini http ${r.status}`;
    throw new Error(`stt: gemini ${msg}`);
  }
  return { text, lang: guessLang(text) };
}

/* ───────────── OpenAI-compatible (FREE backend / OpenRouter) ─────────────── */
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

/* ───────────────────────────── Main router ───────────────────────────────── */
export async function transcribeVoice(env, fileUrl) {
  const errors = [];

  // 1) Cloudflare Workers AI (Whisper) — безкоштовно, швидко
  try { return await transcribeViaCloudflare(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 2) Gemini — працює з inline аудіо (OGG/MP3/WAV)
  try { return await transcribeViaGemini(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 3) OpenRouter (або власний безкоштовний сумісний бекенд)
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

  // Усе впало
  throw new Error("STT providers failed | tried: " + errors.join(" ; "));
}