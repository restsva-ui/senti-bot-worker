// src/lib/speechRouter.js
// Універсальний STT-роутер для Senti.
// Порядок: Cloudflare Workers AI (Whisper) → OpenRouter (OpenAI-совмісний STT) → Free STT (будь-який OpenAI-совмісний бекенд).
// Повертає: { text, lang? } де text — розпізнаний рядок, lang — best-effort ISO-код (heurstic).

/* ───────────────────────── Helpers ───────────────────────── */

async function fetchAsArrayBuffer(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`stt: fetch ${r.status}`);
  return await r.arrayBuffer();
}

function guessLang(s = "") {
  const t = (s || "").trim();
  if (!t) return null;
  // Дуже проста евристика: достатньо для енфорсера в webhook.js
  const cyr = /[А-Яа-яЇїІіЄєҐґ]/;
  const de  = /[ÄäÖöÜüß]/;
  const fr  = /[À-ÿ]/;
  if (cyr.test(t)) {
    // розрізняємо uk/ru примітивно за літерами "ї/є/ґ/і"
    if (/[ЇїЄєҐґІі]/.test(t)) return "uk";
    return "ru";
  }
  if (de.test(t)) return "de";
  if (fr.test(t)) return "fr";
  return "en";
}

/* ───────────────── Cloudflare Whisper ───────────────── */

async function transcribeViaCloudflare(env, fileUrl) {
  const acc = env.CF_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!acc || !token) throw new Error("stt: cf creds missing");

  const ab = await fetchAsArrayBuffer(fileUrl);
  const form = new FormData();
  form.append("file", new Blob([ab], { type: "audio/ogg" }), "voice.ogg");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/openai/whisper`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await r.json().catch(() => null);
  const text =
    data?.result?.text ||
    (Array.isArray(data?.result?.segments) ? data.result.segments.map(s => s?.text || "").join(" ") : "");
  if (!r.ok || !text) {
    const msg = data?.errors?.[0]?.message || `cf http ${r.status}`;
    throw new Error(`stt: cf ${msg}`);
  }
  return { text: text.trim(), lang: guessLang(text) };
}

/* ───────────── OpenAI-сумісні бекенди (multipart) ───────────── */

async function transcribeViaOpenAICompat({ baseUrl, apiKey, model, fileUrl, extraHeaders = {} }) {
  if (!baseUrl) throw new Error("stt: baseUrl missing");

  const ab = await fetchAsArrayBuffer(fileUrl);
  const form = new FormData();
  form.append("file", new Blob([ab], { type: "audio/ogg" }), "voice.ogg");
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

/* ───────────────────── Main router ───────────────────── */

export async function transcribeVoice(env, fileUrl) {
  const errors = [];

  // 1) Cloudflare Whisper (безкоштовно в Workers AI)
  try { return await transcribeViaCloudflare(env, fileUrl); }
  catch (e) { errors.push(String(e?.message || e)); }

  // 2) OpenRouter (OpenAI-сумісний аудіо-ендпойнт)
  //    Багато інстансів приймають model: "openai/whisper-large-v3"
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

  // 3) Будь-який власний OpenAI-сумісний STT (безкоштовний)
  //    Вкажи FREE_STT_BASE_URL (+ FREE_STT_API_KEY, якщо треба)
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
  const note = errors.length ? ` | tried: ${errors.join(" ; ")}` : "";
  throw new Error("STT providers failed" + note);
}
