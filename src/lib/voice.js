// src/lib/voice.js
// TTS router v3.4 — мовні голоси, стабільні фолбеки, Cloudflare-safe

const TTS_DEEPGRAM = "@cf/deepgram/aura-1";
const TTS_MELO     = "@cf/myshell-ai/melotts";

function pickSpeakerByLang(env, lang) {
  const lc = String(lang || "en").toLowerCase();
  const map = {
    uk: (env.VOICE_SPEAKER_UK || "dmytro"),
    ru: (env.VOICE_SPEAKER_RU || "sergei"),
    en: (env.VOICE_SPEAKER_EN || "angus"),
    de: (env.VOICE_SPEAKER_DE || "bernd"),
    fr: (env.VOICE_SPEAKER_FR || "julie"),
  };
  return map[lc] || (env.VOICE_SPEAKER || "angus");
}

function pickMeloLang(lang) {
  const lc = String(lang || "en").toLowerCase();
  if (["uk","ru","en","de","fr"].includes(lc)) return lc;
  return "en";
}

// ————— CF Workers AI runner —————
async function runCfTts(env, model, payload, accept = "audio/mpeg") {
  const acc   = env.CF_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!acc || !token) throw new Error("tts: cf creds missing");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${encodeURIComponent(model)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "Accept": accept
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const msg = await r.text().catch(()=>"");
    throw new Error(`tts: cf http ${r.status} ${msg}`);
  }
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}

// ————— Providers —————
async function ttsAura(env, text, lang) {
  // Deepgram Aura: не потребує мови параметром, але чутливий до speaker
  const speaker = pickSpeakerByLang(env, lang);
  const payload = { text, voice: speaker }; // voice = speaker
  return await runCfTts(env, TTS_DEEPGRAM, payload, "audio/mpeg");
}

async function ttsMelo(env, text, lang) {
  // MeloTTS: підтримує поле language і speaker
  const speaker = pickSpeakerByLang(env, lang);
  const payload = {
    text,
    language: pickMeloLang(lang),
    speaker_id: speaker,
    speed: 1.0
  };
  return await runCfTts(env, TTS_MELO, payload, "audio/mpeg");
}

async function ttsFreeOpenRouter(env, text, lang) {
  const base = env.FREE_TTS_BASE_URL || env.FREE_LLM_BASE_URL || "";
  const key  = env.FREE_TTS_API_KEY || env.FREE_LLM_API_KEY || "";
  const model = env.FREE_TTS_MODEL || "tts-1";
  if (!base) throw new Error("tts: free base missing");
  const r = await fetch(base.replace(/\/+$/,"") + "/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      ...(key ? { "Authorization": `Bearer ${key}` } : {})
    },
    body: JSON.stringify({
      model,
      voice: pickSpeakerByLang(env, lang),
      input: text
    })
  });
  if (!r.ok) throw new Error(`tts: free http ${r.status}`);
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}
export async function speak(env, text, lang = "en") {
  const order = String(env.TTS_ORDER || "").split(",").map(s => s.trim()).filter(Boolean);
  const errors = [];

  for (const prov of order) {
    try {
      if (prov === TTS_DEEPGRAM || prov === "@cf/deepgram/aura-1") {
        return await ttsAura(env, text, lang);
      }
      if (prov === TTS_MELO || prov === "@cf/myshell-ai/melotts") {
        return await ttsMelo(env, text, lang);
      }
      if (prov === "free") {
        return await ttsFreeOpenRouter(env, text, lang);
      }
    } catch (e) {
      errors.push(String(e?.message || e));
    }
  }
  throw new Error("TTS providers failed | " + errors.join(" ; "));
}