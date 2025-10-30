// src/lib/speechRouter.js
// Каскад STT: Gemini → Cloudflare Workers AI (Whisper) → OpenAI-compatible fallback.
// На вхід: URL на Telegram voice (.ogg, opus). На вихід: { text }.
//
// Виклик: const { text } = await transcribeVoice(env, oggUrl, { lang: "uk" });

function b64FromBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function fetchAsBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch audio ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  return { base64: b64FromBytes(bytes), bytes };
}

function pickLang(envLang, fallback = "uk") {
  const s = String(envLang || "").trim().toLowerCase();
  const allow = ["uk", "ru", "en", "de", "fr"];
  if (allow.includes(s)) return s;
  if (s.startsWith("uk")) return "uk";
  if (s.startsWith("ru")) return "ru";
  if (s.startsWith("en")) return "en";
  if (s.startsWith("de")) return "de";
  if (s.startsWith("fr")) return "fr";
  return fallback;
}

/* ───────────────────────────── Gemini 1.5 (multimodal) ──────────────────── */
async function sttGemini(env, { base64, mime, lang }) {
  const key =
    env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY || "";
  if (!key) throw new Error("Gemini key missing");

  // Для транскрипції віддаємо один parts: inline_data (audio) + інструкція.
  // Модель: 1.5-pro працює надійніше для аудіо.
  const model = env.GEMINI_STT_MODEL || "models/gemini-1.5-pro";
  const url = `https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(
    key
  )}`;

  const systemHint = `You transcribe speech to plain text only. 
Return ${lang.toUpperCase()} language if possible. 
Do not add explanations or emojis.`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: systemHint },
          {
            inline_data: {
              mime_type: mime,
              data: base64,
            },
          },
        ],
      },
    ],
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`gemini http ${r.status} ${err.slice(0, 300)}`);
  }
  const data = await r.json();
  const txt =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  const out = String(txt || "").trim();
  if (!out) throw new Error("gemini empty");
  return { text: out };
}

/* ─────────────────── Cloudflare Workers AI (@cf/openai/whisper-1) ───────── */
async function sttCloudflare(env, { base64, mime, lang }) {
  const accountId = env.CF_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error("CF credentials missing");

  // Використовуємо AI Run endpoint. Для openai/whisper-1 ключ — "audio".
  // mime використаємо як підказку. Деякі ревізії приймають також audio_format.
  const model = env.CF_STT_MODEL || "@cf/openai/whisper-1";
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(
    model
  )}`;

  const payload = {
    // Основне поле, яке очікує CF whisper-1
    audio: base64,
    // Підказка мови: не обов'язково, але не завадить
    language: lang,
    // Додатково інформаційно (не критично)
    mime_type: mime,
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`cf http ${r.status} ${err.slice(0, 300)}`);
  }
  const data = await r.json();
  // У Workers AI дані можуть прийти як { result: { text: "..." } } або просто { text: ... }.
  const text =
    data?.result?.text || data?.text || data?.result || data?.output || "";
  const out = String(text || "").trim();
  if (!out) throw new Error("cf empty");
  return { text: out };
}

/* ───────────────── OpenAI-compatible /audio/transcriptions fallback ─────── */
async function sttOpenAICompat(env, { base64, mime, lang }) {
  const base = env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL || env.OPENAI_BASE_URL;
  const key = env.FREE_LLM_API_KEY || env.FREE_API_KEY || env.OPENAI_API_KEY;
  if (!base || !key) throw new Error("openai-compat creds missing");

  // Більшість сумісних бекендів приймають multipart/form-data.
  // Але у Workers середовищі простіше JSON: деякі сумісні сервіси мають JSON шлях.
  // Спробуємо стандартний OpenAI JSON для /v1/audio/transcriptions (якщо бекенд підтримує).
  const url = `${base.replace(/\/+$/,"")}/v1/audio/transcriptions`;

  const body = {
    model: "whisper-1",
    // Декотрі сумісні бекенди дозволяють "file" як base64
    // Якщо твій бекенд вимагає multipart — замінимо реалізацію під нього за потреби.
    file: `data:${mime};base64,${base64}`,
    language: lang,
    response_format: "json",
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`openai-compat http ${r.status} ${err.slice(0, 300)}`);
  }
  const data = await r.json();
  const out = String(data?.text || data?.result || "").trim();
  if (!out) throw new Error("openai-compat empty");
  return { text: out };
}

/* ────────────────────────────── Public API ───────────────────────────────── */
export async function transcribeVoice(env, tgFileUrl, opts = {}) {
  // 1) качаємо файл як байти → base64
  const { base64 } = await fetchAsBase64(tgFileUrl);
  // Telegram voice — зазвичай OGG/OPUS
  const mime = String(opts?.mime || "audio/ogg");
  const lang = pickLang(opts?.lang || env.DEFAULT_LANGUAGE || "uk");

  const errors = [];

  // 2) Каскад провайдерів
  // 2.1) Gemini
  try {
    return await sttGemini(env, { base64, mime, lang });
  } catch (e) {
    errors.push(`stt: gemini ${e.message || e}`);
  }

  // 2.2) Cloudflare Workers AI (Whisper)
  try {
    return await sttCloudflare(env, { base64, mime, lang });
  } catch (e) {
    errors.push(`stt: cf ${e.message || e}`);
  }

  // 2.3) OpenAI-compatible fallback
  try {
    return await sttOpenAICompat(env, { base64, mime, lang });
  } catch (e) {
    errors.push(`stt: openai-compat ${e.message || e}`);
  }

  // Якщо все зламалося — піднімаємо узагальнену помилку для адміна
  throw new Error(`STT providers failed | ${errors.join(" ; ")}`);
}