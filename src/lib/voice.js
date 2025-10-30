// src/lib/voice.js
// Голос для Senti: TTS каскад (Aura → MeloTTS → Free), STT (Whisper), Telegram helpers.
// Писалось під Cloudflare Workers (fetch + FormData + Blob), без node:fs.
//
// Авторежими за замовчуванням:
//   TTS_ORDER = "@cf/deepgram/aura-1,@cf/myshell-ai/melotts,free"
//   VOICE_REPLY_DEFAULT = "off"

const KV_KEYS = {
  voiceReply: (uid) => `voice:reply:${uid}`, // "on" | "off"
};

function pickKV(env) {
  return env.STATE_KV || env.CHECKLIST_KV || env.ENERGY_LOG_KV || env.LEARN_QUEUE_KV;
}

// ───────────────────────────── Helpers ─────────────────────────────
function toBase64(u8) {
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  // btoa доступний у Workers
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function trimOrder(s) {
  return String(s || "").split(",").map(x => x.trim()).filter(Boolean);
}

// ───────────────────────────── TTS: Aura ──────────────────────────
// Повертає OGG/OPUS (придатний для sendVoice)
async function ttsAura(env, { text, speaker, lang }) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const acc = env.CF_ACCOUNT_ID;
  if (!token || !acc) throw new Error("CF credentials missing for Aura");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/deepgram/aura-1`;
  const body = {
    text: String(text || ""),
    // Ключове: отримати голосовий формат для Telegram voice
    encoding: "opus",
    container: "ogg",
    ...(speaker ? { speaker } : {}),
  };

  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`aura http ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.length) throw new Error("aura: empty audio");
  return { kind: "voice", mime: "audio/ogg", bytes }; // готово до sendVoice
}
// ───────────────────────────── TTS: MeloTTS ───────────────────────
// Повертає MP3 (надсилати як sendAudio)
async function ttsMelo(env, { text, lang }) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const acc = env.CF_ACCOUNT_ID;
  if (!token || !acc) throw new Error("CF credentials missing for MeloTTS");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/myshell-ai/melotts`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: String(text || ""), lang: String(lang || "en") }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error(`melotts http ${r.status}`);
  const b64 = data?.result?.audio || data?.audio;
  if (!b64) throw new Error("melotts: no audio");
  const bytes = fromBase64(b64);
  return { kind: "audio", mime: "audio/mpeg", bytes }; // sendAudio
}

// ───────────────────────────── TTS: FREE endpoint ─────────────────
// Очікуємо OpenAI-сумісний /v1/audio/speech (model, voice, input)
async function ttsFree(env, { text }) {
  const base = String(env.FREE_TTS_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("FREE_TTS_BASE_URL missing");
  const key = env.FREE_TTS_API_KEY || "";
  const model = env.FREE_TTS_MODEL || "tts-1";
  const voice = env.FREE_TTS_VOICE || "alloy";

  const r = await fetch(`${base}/v1/audio/speech`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ model, voice, input: String(text || "") }),
  });
  if (!r.ok) throw new Error(`free tts http ${r.status}`);
  const mime = r.headers.get("content-type") || "audio/mpeg";
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (!bytes.length) throw new Error("free tts: empty audio");
  return { kind: "audio", mime, bytes }; // найчастіше mp3 → sendAudio
}

// ───────────────────────────── STT: Whisper ───────────────────────
// Приймає байти OGG/OPUS/MP3/WAV; шле base64 у Workers AI Whisper.
export async function transcribeVoice(env, bytes, { langHint } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const acc = env.CF_ACCOUNT_ID;
  if (!token || !acc) throw new Error("CF credentials missing for Whisper");

  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/openai/whisper-large-v3-turbo`;
  const audio = toBase64(bytes);
  const body = { audio, ...(langHint ? { language: langHint } : {}) };

  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error(`whisper http ${r.status}`);
  const text = data?.result?.text || data?.text || "";
  if (!text) throw new Error("whisper: empty text");
  return { text, info: data?.result || data };
}
// ───────────────────────────── КАСКАД TTS ─────────────────────────
export async function synthesizeVoice(env, { text, lang = "uk" }) {
  const order = trimOrder(env.TTS_ORDER || "@cf/deepgram/aura-1,@cf/myshell-ai/melotts,free");
  let lastErr = null;
  for (const item of order) {
    try {
      if (item === "@cf/deepgram/aura-1") {
        const speaker = env.VOICE_SPEAKER || (lang.startsWith("uk") ? "angus" : "angus"); // можна змінити
        return await ttsAura(env, { text, speaker, lang });
      }
      if (item === "@cf/myshell-ai/melotts") {
        return await ttsMelo(env, { text, lang });
      }
      if (item === "free" || item.startsWith("free")) {
        return await ttsFree(env, { text, lang });
      }
      // невідомий пункт — пропускаємо
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr || new Error("TTS cascade failed");
}

// ───────────────────────────── Telegram send ──────────────────────
export async function sendTgVoiceOrAudio(env, chatId, { bytes, mime, caption }) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN missing");
  const base = `https://api.telegram.org/bot${token}`;

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  if (caption) fd.append("caption", String(caption));

  if ((mime || "").includes("ogg")) {
    // Voice
    fd.append("voice", new Blob([bytes], { type: "audio/ogg" }), "senti.ogg");
    const r = await fetch(`${base}/sendVoice`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`sendVoice http ${r.status}`);
    return await r.json();
  } else {
    // Audio (mp3/other)
    fd.append("audio", new Blob([bytes], { type: mime || "audio/mpeg" }), "senti.mp3");
    const r = await fetch(`${base}/sendAudio`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`sendAudio http ${r.status}`);
    return await r.json();
  }
}

// ───────────────────────────── KV тумблер голосу ─────────────────
export async function isVoiceReplyOn(env, userId) {
  const kv = pickKV(env); if (!kv) return false;
  try { return (await kv.get(KV_KEYS.voiceReply(userId))) === "on"; } catch { return false; }
}
export async function setVoiceReply(env, userId, on) {
  const kv = pickKV(env); if (!kv) return;
  try { await kv.put(KV_KEYS.voiceReply(userId), on ? "on" : "off"); } catch {}
}

// ───────────────────────────── TG файл → байти ───────────────────
// Зручно викликати з webhook: передаєш file_id → отримуєш Uint8Array
export async function tgFileToBytes(env, file_id) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const info = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id })
  });
  const meta = await info.json().catch(() => null);
  if (!meta?.ok) throw new Error("getFile failed");
  const path = meta.result?.file_path;
  const fileUrl = `https://api.telegram.org/file/bot${token}/${path}`;
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) throw new Error(`fetch voice ${fileResp.status}`);
  const ab = await fileResp.arrayBuffer();
  return new Uint8Array(ab);
}
