/* ───────────── Imports ───────────── */
import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary, askVision } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune, autoUpdateSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage, detectFromText } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import { enqueueLearn, getRecentInsights } from "../lib/kvLearnQueue.js";
import { transcribeVoice } from "../lib/speechRouter.js";
import { dateIntent, timeIntent, replyCurrentDate, replyCurrentTime } from "../apis/time.js";
import { weatherSummaryByPlace, weatherSummaryByCoords } from "../apis/weather.js";
import { setUserLocation, getUserLocation } from "../lib/geo.js";

/* ───────────── Telegram helpers & UI ───────────── */
const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_LEARN,
  mainKeyboard, ADMIN, energyLinks, sendPlain, parseAiCommand,
  askLocationKeyboard
} = TG;

const KV = {
  learnMode: (uid) => `learn:mode:${uid}`,
  learnModeExp: (uid) => `learn:mode:exp:${uid}`,
  lastPhotoUrl: (chatId) => `last:photo:url:${chatId}`,
};

async function sendTyping(env, chatId) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {}
}
function pulseTyping(env, chatId, times = 4, intervalMs = 3500) {
  sendTyping(env, chatId);
  for (let i = 1; i < times; i++) setTimeout(() => sendTyping(env, chatId), i * intervalMs);
}

/* ───────────── Image MIME helpers ───────────── */
function sniffImageMime(u8) {
  if (!u8 || u8.length < 12) return "";
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "image/jpeg";
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47 && u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a) return "image/png";
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return "image/webp";
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) return "image/gif";
  if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
    const f = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
    if (["heic","heix","mif1"].includes(f)) return "image/heic";
    if (["avif","avis"].includes(f)) return "image/avif";
  }
  return "";
}
function normalizeImageMime(headerCt, u8, fallback = "image/jpeg") {
  const ct = (headerCt || "").toLowerCase().trim();
  if (!ct || ct === "application/octet-stream") return sniffImageMime(u8) || fallback;
  if (ct === "image/jpg") return "image/jpeg";
  return ct;
}
async function fetchToBase64WithMime(url, defaultMime = "image/jpeg") {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch media ${r.status}`);
  const ab = await r.arrayBuffer();
  const u8 = new Uint8Array(ab);
  const headerCt = (r.headers.get("content-type") || "").toLowerCase();
  const mime = normalizeImageMime(headerCt, u8, defaultMime);
  let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return { b64: btoa(s), mime };
}

/* ───────────── Vision order filter ───────────── */
function filterVisionOrder(orderStr = "") {
  const raw = String(orderStr || "").split(",").map(s => s.trim()).filter(Boolean);
  const keep = raw.filter(m =>
    /^cf:@cf\/meta\/llama-3\.2-11b-vision-instruct$/i.test(m) ||
    /^gemini:gemini-2\.0-.*(flash|vision).*$/i.test(m)
  );
  if (!keep.length) keep.push("cf:@cf/meta/llama-3.2-11b-vision-instruct");
  return keep.join(", ");
}

/* ───────────── Language helpers ───────────── */
function langNameFor(code = "uk") {
  const c = String(code || "uk").slice(0,2).toLowerCase();
  const map = { uk:"українською", ru:"російською", en:"English", de:"Deutsch", fr:"français" };
  return map[c] || "українською";
}
function chooseVoice(env, lang = "uk") {
  const key = `VOICE_SPEAKER_${String(lang).toUpperCase()}`;
  const override = (env[key] || "").trim();
  if (override) return override;
  const v = (env.VOICE_SPEAKER || "").trim();
  if (v && v.toLowerCase() !== "auto") return v;
  const byLang = { uk:"oleksandr", ru:"sergei", en:"angus", de:"bernd", fr:"julie" };
  return byLang[String(lang).toLowerCase()] || "angus";
}

/* ── Vision describe / place ── */
async function visionDescribe(env, { imageUrl, userPrompt = "", lang = "uk", systemHint }) {
  const rawOrder = String(env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "@cf/meta/llama-3.2-11b-vision-instruct").trim();
  const modelOrder = filterVisionOrder(rawOrder);
  const { b64, mime } = await fetchToBase64WithMime(imageUrl, "image/jpeg");
  const langName = langNameFor(lang);
  const baseTask =
`Опиши зображення коротко ${langName}. Якщо є текст іншою мовою — передай сенс ${langName}. Не вигадуй деталей.`;
  const prompt = userPrompt ? `${baseTask}\n\nДодатковий контекст: «${userPrompt}».` : baseTask;
  const strongSystem = (systemHint ? `${systemHint}\n\n` : "") + `STRICT LANGUAGE POLICY: Answer ONLY in ${langName}.`;
  const out = await askVision(env, modelOrder, prompt, { systemHint: strongSystem, imageBase64: b64, imageMime: mime, temperature: 0.2 });
  return String(out || "").trim();
}
async function visionPlace(env, { imageUrl, lang = "uk", systemHint }) {
  const rawOrder = String(env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "@cf/meta/llama-3.2-11b-vision-instruct").trim();
  const modelOrder = filterVisionOrder(rawOrder);
  const { b64, mime } = await fetchToBase64WithMime(imageUrl, "image/jpeg");
  const langName = langNameFor(lang);
  const prompt =
`Визнач місце на фото. Якщо впевнений — коротко ${langName}:
• Назва/місто/країна.
• На новому рядку: "🔗 https://www.google.com/maps/search/?api=1&query=<назва або координати>".
Якщо не впевнений — 1–2 ймовірні варіанти з такими ж лінками.`;
  const strongSystem = (systemHint ? `${systemHint}\n\n` : "") + `STRICT LANGUAGE POLICY: Answer ONLY in ${langName}.`;
  const out = await askVision(env, modelOrder, prompt, { systemHint: strongSystem, imageBase64: b64, imageMime: mime, temperature: 0.2 });
  return String(out || "").trim();
}

/* ───────────── Drive/Media helpers ───────────── */
function extractFirstUrl(text = "") { const m = String(text || "").match(/https?:\/\/\S+/i); return m ? m[0] : null; }
async function getLearnMode(env, userId) { try { return (await env.STATE_KV.get(KV.learnMode(userId))) === "on"; } catch { return false; } }
async function setLearnMode(env, userId, on, ttlSec = 3600) {
  try {
    if (on) {
      await env.STATE_KV.put(KV.learnMode(userId), "on", { expirationTtl: ttlSec });
      await env.STATE_KV.put(KV.learnModeExp(userId), String(Date.now() + ttlSec * 1000), { expirationTtl: ttlSec });
    } else {
      await env.STATE_KV.put(KV.learnMode(userId), "off", { expirationTtl: 60 });
    }
  } catch {}
}

async function tgFileUrl(env, file_id) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ file_id })
  });
  const data = await r.json().catch(() => null);
  if (!data?.ok) throw new Error("getFile failed");
  const path = data.result?.file_path;
  if (!path) throw new Error("file_path missing");
  return `https://api.telegram.org/file/bot${token}/${path}`;
}

function pickPhoto(msg) {
  const arr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!arr?.length) return null;
  const ph = arr[arr.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document){const d=msg.document;return{type:"document",file_id:d.file_id,name:d.file_name||`doc_${d.file_unique_id}`};}
  if (msg.video)   {const v=msg.video;   return{type:"video",file_id:v.file_id,name:v.file_name||`video_${v.file_unique_id}.mp4`};}
  if (msg.audio)   {const a=msg.audio;   return{type:"audio",file_id:a.file_id,name:a.file_name||`audio_${a.file_unique_id}.mp3`};}
  if (msg.voice)   {const v=msg.voice;   return{type:"voice",file_id:v.file_id,name:`voice_${v.file_unique_id}.ogg`};}
  if (msg.video_note){const v=msg.video_note;return{type:"video_note",file_id:v.file_id,name:`videonote_${v.file_unique_id}.mp4`};}
  return pickPhoto(msg);
}

/* ───────────── TTS (CF) ───────────── */
async function cfRunTTS(env, text, lang = "uk") {
  const acc = env.CF_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!acc || !token) throw new Error("tts: CF creds missing");

  const order = String(env.TTS_ORDER || "@cf/myshell-ai/melotts").split(",").map(s=>s.trim()).filter(Boolean);
  const errs = [];
  for (const model of order) {
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${model}`;
      const body = { text, voice: chooseVoice(env, lang), format: "mp3", language: lang };
      const r = await fetch(url, { method:"POST", headers:{ "Authorization":`Bearer ${token}`, "content-type":"application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`http ${r.status}`);
      const ct = r.headers.get("content-type") || "";
      if (/application\/json/i.test(ct)) {
        const data = await r.json();
        const b64 = data?.result?.audio || data?.result?.output || data?.audio || data?.output;
        if (!b64) throw new Error("empty audio");
        const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new Blob([bin], { type: "audio/mpeg" });
      } else {
        const ab = await r.arrayBuffer();
        return new Blob([ab], { type: "audio/mpeg" });
      }
    } catch (e) { errs.push(`${model}: ${String(e.message || e)}`); }
  }
  throw new Error("tts failed | " + errs.join(" ; "));
}
async function sendAudioTg(env, chatId, audioBlob, caption = "") {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption);
  form.append("audio", audioBlob, "senti-reply.mp3");
  const r = await fetch(`https://api.telegram.org/bot${token}/sendAudio`, { method: "POST", body: form });
  if (!r.ok) throw new Error(`tg sendAudio http ${r.status}`);
}
async function synthAndSendAudio(env, chatId, text, lang = "uk") {
  try {
    const blob = await cfRunTTS(env, text, lang);
    await sendAudioTg(env, chatId, blob, "🎧");
  } catch {}
}
/* Voice/STT */
function containsCyrillic(s=""){return /[\u0400-\u04FF]/.test(s);}
async function handleVoiceSTT(env, chatId, userId, msg, lang) {
  if (!msg?.voice?.file_id) return false;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) { const links = energyLinks(env, userId); await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy)); return true; }
  await spendEnergy(env, userId, need, "voice");

  pulseTyping(env, chatId);
  await sendPlain(env, chatId, "🎙️ Обробляю голос...");

  try {
    const url = await tgFileUrl(env, msg.voice.file_id);
    const { text: stt, lang: sttLang } = await transcribeVoice(env, url);
    const effLang = (sttLang || detectFromText(stt) || lang || "uk").slice(0,2);

    await pushTurn(env, userId, "user", stt);
    await autoUpdateSelfTune(env, userId, effLang).catch(() => {});

    const systemHint = await buildSystemHint(env, chatId, userId, effLang);
    const name = await getPreferredName(env, msg);
    let { short, full } = await callSmartLLM(env, stt, { lang: effLang, name, systemHint, expand: false, adminDiag: ADMIN(env, userId) });

    // ── СУПЕР-ГАРАНТ мови: якщо укр, але в відповіді немає кирилиці — переписати укр.
    if (effLang === "uk" && !containsCyrillic(short)) {
      const langName = langNameFor("uk");
      const fix = `Rewrite EXACTLY in ${langName}. Keep it concise. No prefaces.`;
      const fixed = await askAnyModel(env, env.MODEL_ORDER, `${short}\n\n${fix}`, { systemHint });
      if (fixed && containsCyrillic(fixed)) { short = fixed.trim(); full = fixed.trim(); }
    }

    await pushTurn(env, userId, "assistant", full);
    await sendPlain(env, chatId, short);

    if ((env.VOICE_REPLY_DEFAULT || "off").toLowerCase() === "on") {
      await synthAndSendAudio(env, chatId, short, effLang);
    }
  } catch (e) {
    if (ADMIN(env, userId)) await sendPlain(env, chatId, `❌ Error: STT providers failed | ${String(e?.message || e).slice(0, 220)}`);
    else await sendPlain(env, chatId, "На жаль, не вдалось розпізнати голос. Спробуй ще раз 🙏");
  }
  return true;
}

/* ───────────── SystemHint / name / language enforcement ───────────── */
async function buildSystemHint(env, chatId, userId, preferredLang) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId, { preferredLang }).catch(() => null);

  const core = `You are Senti — a thoughtful, self-improving companion.
- Never claim to be an AI/model or a product of any company.
- Speak naturally and empathetically.
- Keep answers short unless user asks to expand.`;

  let insightsBlock = "";
  try {
    const insights = await getRecentInsights(env, { limit: 5 });
    if (insights?.length) {
      const lines = insights.map(i => `• ${i.insight}${i.r2Key ? " [R2]" : ""}`);
      insightsBlock = `[Recent insights]\n${lines.join("\n")}`;
    }
  } catch {}

  const blocks = [core];
  if (statut) blocks.push(`[Statute / Checklist]\n${statut}`);
  if (tune) blocks.push(`[Self-Tune]\n${tune}`);
  if (insightsBlock) blocks.push(insightsBlock);
  if (dlg) blocks.push(dlg);
  return blocks.join("\n\n");
}

function revealsAiSelf(out = "") {
  const s = out.toLowerCase();
  return (
    /(^|\b)as an? (ai|language model)\b/.test(s) ||
    /\bi am (an|a)? (ai|language model|large language model)\b/.test(s) ||
    /\bdeveloped by (google|openai|meta|anthropic)\b/.test(s) ||
    /я\s+(є|—|-)?\s*(штучн|модель|мова)/i.test(out) ||
    /я\s+(являюсь|есть)\s+(ии|искусственн|языков)/i.test(out)
  );
}
function stripProviderSignature(s = "") { return String(s).replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "").trim(); }
function guessEmoji(text = "") { const x = text.toLowerCase(); if (x.includes("машин")||x.includes("car"))return"🚗"; if(x.includes("світл")||x.includes("light"))return"☀️"; if(x.includes("вода")||x.includes("water"))return"💧"; return "💡"; }
function looksLikeModelDump(s=""){const x=s.toLowerCase();return /here(?:'|)s a breakdown|model (aliases|mappings|configurations)/i.test(x)||/gemini-?2\.5|openrouter|deepseek|llama/i.test(x);}
function limitMsg(s,m=220){if(!s)return s;return s.length<=m?s:s.slice(0,m-1);}

async function getPreferredName(env, msg) {
  const uid = msg?.from?.id;
  const kv = env?.STATE_KV;
  let v = null;
  try { v = await kv.get(`profile:name:${uid}`); } catch {}
  return v || msg?.from?.first_name || msg?.username || "друже";
}
function tryParseUserNamedAs(text) {
  const s = (text || "").trim();
  const NAME_RX = "([A-Za-zÀ-ÿĀ-žЀ-ӿʼ'`\\-\\s]{2,30})";
  const patterns = [
    new RegExp(`\\bмене\\s+звати\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bменя\\s+зовут\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bmy\\s+name\\s+is\\s+${NAME_RX}`, "iu"),
  ];
  for (const r of patterns) { const m = s.match(r); if (m?.[1]) return m[1].trim(); }
  return null;
}
async function rememberNameFromText(env, userId, text) {
  const name = tryParseUserNamedAs(text);
  if (!name) return null;
  try { await env.STATE_KV.put(`profile:name:${userId}`, name); } catch {}
  return name;
}

async function callSmartLLM(env, userText, { lang, name, systemHint, expand, adminDiag = false }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();
  const langName = langNameFor(lang);

  const control = expand
    ? `You are Senti — a thoughtful, empathetic assistant. **Respond ONLY in ${langName}**. Keep it structured and concise.`
    : `You are Senti. **Answer ONLY in ${langName}**, 1–3 короткі фрази.`;

  const prompt = `Add one relevant emoji at the start if natural.
User (${name}) says: ${userText}
${control}`;

  let out;
  try {
    out = modelOrder
      ? await askAnyModel(env, modelOrder, prompt, { systemHint })
      : await think(env, prompt, { systemHint });
  } catch (e) {
    if (adminDiag) throw e;
    throw new Error("LLM call failed");
  }

  out = stripProviderSignature((out || "").trim());
  if (looksLikeModelDump(out)) {
    out = stripProviderSignature((await think(env, prompt, { systemHint }))?.trim() || out);
  }
  if (revealsAiSelf(out)) {
    const fix = `Rewrite the answer as Senti. Do NOT mention being an AI/model or any company. Keep it ${langName}, коротко.`;
    let cleaned = modelOrder ? await askAnyModel(env, modelOrder, fix, { systemHint }) : await think(env, fix, { systemHint });
    cleaned = stripProviderSignature((cleaned || "").trim());
    if (cleaned) out = cleaned;
  }
  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const force = `STRICT LANGUAGE MODE: Respond ONLY in ${langName}. Rewrite the previous answer in ${langName} without extra preface.`;
    let fixed = modelOrder ? await askAnyModel(env, modelOrder, force, { systemHint }) : await think(env, force, { systemHint });
    fixed = stripProviderSignature((fixed || "").trim());
    if (fixed) out = fixed;
  }

  if (!/^[\p{Emoji}\p{Extended_Pictographic}]/u.test(out || "")) out = `${guessEmoji(userText)} ${out}`;
  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}

/* ───────────── Media handlers ───────────── */
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  let hasTokens = false;
  try { const tokens = await getUserTokens(env, userId); hasTokens = !!tokens; } catch {}
  if (!hasTokens) {
    const connectUrl = abs(env, "/auth/drive");
    await sendPlain(env, chatId,
      t(lang, "drive_connect_hint") || "Щоб зберігати файли, підключи Google Drive.",
      { reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn") || "Підключити Drive", url: connectUrl }]] } }
    );
    return true;
  }

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costImage ?? 5);
  if ((cur.energy ?? 0) < need) { const links = energyLinks(env, userId); await sendPlain(env, chatId, t(lang, "need_energy_media", need, links.energy)); return true; }
  await spendEnergy(env, userId, need, "media");

  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendPlain(env, chatId, `✅ ${t(lang, "saved_to_drive")}: ${saved?.name || att.name}`, {
    reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn"), url: "https://drive.google.com/drive/my-drive" }]] }
  });
  return true;
}

/* Vision-режим: опис + кнопка «Визначити місце» + пам’ять останнього фото */
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const att = pickPhoto(msg);
  if (!att) return false;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) { const links = energyLinks(env, userId); await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy)); return true; }
  await spendEnergy(env, userId, need, "vision");

  pulseTyping(env, chatId);
  const url = await tgFileUrl(env, att.file_id);
  try {
    await env.STATE_KV.put(KV.lastPhotoUrl(chatId), url, { expirationTtl: 3600 });

    const systemHint = await buildSystemHint(env, chatId, userId, lang);
    const resp = await visionDescribe(env, { imageUrl: url, userPrompt: caption, lang, systemHint });
    await sendPlain(env, chatId, `🖼️ ${resp}`, {
      reply_markup: { inline_keyboard: [[{ text: "📍 Визначити місце", callback_data: "ask_place" }]] }
    });
  } catch (e) {
    const raw = String(env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "").trim();
    const filtered = filterVisionOrder(raw);
    if (ADMIN(env, userId)) {
      await sendPlain(env, chatId, `❌ Vision error: ${String(e?.message || e).slice(0, 320)}\n(modelOrder raw: ${raw || "n/a"})\n(modelOrder used: ${filtered})`);
    } else {
      const connectUrl = abs(env, "/auth/drive");
      await sendPlain(env, chatId,
        "Поки що не вдалось проаналізувати фото. Можу зберегти його у Google Drive — натисни «Google Drive».",
        { reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn") || "Підключити Drive", url: connectUrl }]] } }
      );
    }
  }
  return true;
}

/* Learn-режим: автопоглинання URL */
export async function learnAbsorbIfAny(env, chatId, userId, textRaw, lang) {
  const url = extractFirstUrl(textRaw);
  if (!url) return false;

  if ((env.LEARN_ENABLED || "on").toLowerCase() !== "on") {
    await sendPlain(env, chatId, "🧠 Learn тимчасово вимкнено адміністратором.");
    return true;
  }
  if (!env.LEARN_BUCKET) {
    await sendPlain(env, chatId, "🧠 Помилка: не налаштований R2 LEARN_BUCKET. Відкрий /admin → Checklist.");
    return true;
  }

  try {
    await enqueueLearn(env, { url, userId });
    await sendPlain(env, chatId, `✅ Додав у Learn: ${url}`, {
      reply_markup: { inline_keyboard: [[{ text: "🧠 Open Learn", url: abs(env, "/admin/learn") }]] }
    });
    return true;
  } catch (e) {
    await sendPlain(env, chatId, "Не вдалось додати у Learn. Скинь ще раз або відкрий панель.", {
      reply_markup: { inline_keyboard: [[{ text: "🧠 Open Learn", url: abs(env, "/admin/learn") }]] }
    });
    return true;
  }
}
export async function finishDialog(env, chatId, userId, textRaw, isAdmin, lang, msg) {
  const name = await getPreferredName(env, msg);
  if (textRaw) await rememberNameFromText(env, userId, textRaw).catch(()=>{});
  const systemHint = await buildSystemHint(env, chatId, userId, lang);
  const { short, full } = await callSmartLLM(env, textRaw, { lang, name, systemHint, expand: false, adminDiag: isAdmin });

  await pushTurn(env, userId, "user", textRaw);
  await pushTurn(env, userId, "assistant", full);

  await sendPlain(env, chatId, short, { reply_markup: TG.mainKeyboard(isAdmin) });
  if ((env.VOICE_REPLY_DEFAULT || "off").toLowerCase() === "on") {
    await synthAndSendAudio(env, chatId, short, lang);
  }
}

export async function handleTextWithLearnAndDialog(env, chatId, userId, textRaw, isAdmin, lang) {
  const learnMode = await getLearnMode(env, userId);
  if (learnMode && textRaw) {
    const done = await learnAbsorbIfAny(env, chatId, userId, textRaw, lang);
    if (done) return true;
  }
  return false;
}

/* ───────────── MAIN webhook ───────────── */
export async function handleTelegramWebhook(req, env) {
  // Validate secret on POST
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    const expected = env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "";
    if (expected && sec !== expected) return json({ ok: false, error: "unauthorized" }, { status: 401 });
  } else {
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  let update; try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }

  // ── Callback: «📍 Визначити місце»
  if (update.callback_query?.data === "ask_place") {
    const chatId = update.callback_query.message?.chat?.id;
    const userId = update.callback_query.from?.id;
    const lang = pickReplyLanguage(update.callback_query.message, "");
    if (!chatId) return json({ ok: true });

    try {
      const lastUrl = await env.STATE_KV.get(KV.lastPhotoUrl(chatId));
      if (!lastUrl) {
        await sendPlain(env, chatId, "Немає останнього фото для визначення локації.");
      } else {
        pulseTyping(env, chatId);
        const systemHint = await buildSystemHint(env, chatId, userId, lang);
        const ans = await visionPlace(env, { imageUrl: lastUrl, lang, systemHint });
        await sendPlain(env, chatId, `📍 ${ans}`);
      }
    } catch (e) {
      await sendPlain(env, chatId, "Помилка визначення місця. Спробуй ще раз.");
    }

    // acknowledge callback
    try {
      const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: update.callback_query.id })
      });
    } catch {}
    return json({ ok: true });
  }

  // ── Regular messages
  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  if (!chatId) return json({ ok: false }, { status: 200 });

  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  let lang = pickReplyLanguage(msg, textRaw);

  // location
  if (msg?.location && userId) {
    await setUserLocation(env, userId, msg.location);
    const okMap = {
      uk: "✅ Локацію збережено. Тепер я показуватиму погоду для вашого місця.",
      ru: "✅ Локация сохранена. Теперь смогу показывать погоду для вашего места.",
      en: "✅ Location saved. I can now show weather for your area.",
    };
    const lc = (msg?.from?.language_code || lang || "uk").slice(0,2);
    await sendPlain(env, chatId, okMap[lc] || okMap.uk, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  // /start
  if (textRaw === "/start") {
    const profileLang = (msg?.from?.language_code || "").slice(0,2).toLowerCase();
    const startLang = ["uk","ru","en","de","fr"].includes(profileLang) ? profileLang : lang;
    const name = await getPreferredName(env, msg);
    await sendPlain(env, chatId, `${t(startLang, "hello_name", name)} ${t(startLang, "how_help")}`, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  // Admin panel
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot" || textRaw === BTN_ADMIN) {
    const rawVision = String(env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "").trim();
    const usedVision = filterVisionOrder(rawVision);
    const mo = String(env.MODEL_ORDER || "").trim();
    const hasGemini = !!(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY);
    const hasCF = !!(env.CLOUDFLARE_API_TOKEN && env.CF_ACCOUNT_ID);
    const hasOR = !!(env.OPENROUTER_API_KEY);
    const hasFreeBase = !!(env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL);
    const hasFreeKey = !!(env.FREE_LLM_API_KEY || env.FREE_API_KEY);

    const lines = [
      t(lang, "admin_header"),
      `MODEL_ORDER: ${mo || "(not set)"}`,
      `VISION_ORDER raw: ${rawVision || "(not set)"}\nVISION_ORDER used: ${usedVision}`,
      `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
      `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${hasCF ? "✅" : "❌"}`,
      `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
      `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
    ];
    const entries = mo ? mo.split(",").map(s=>s.trim()).filter(Boolean) : [];
    if (entries.length) {
      const health = await getAiHealthSummary(env, entries);
      lines.push("\n— Health:");
      for (const h of health) {
        const light = h.cool ? "🟥" : (h.slow ? "🟨" : "🟩");
        const ms = h.ewmaMs ? `${Math.round(h.ewmaMs)}ms` : "n/a";
        lines.push(`${light} ${h.provider}:${h.model} — ewma ${ms}, fails ${h.failStreak || 0}`);
      }
    }
    await sendPlain(env, chatId, lines.join("\n"), {
      reply_markup: {
        inline_keyboard: [[
          { text: "🧠 Open Learn", url: abs(env, "/admin/learn") },
          { text: "📋 Checklist", url: abs(env, "/admin/checklist") }
        ]]
      }
    });
    return json({ ok: true });
  }

  // UI кнопки
  if (textRaw === BTN_DRIVE) { await setDriveMode(env, userId, true);  await setLearnMode(env, userId, false); await sendPlain(env, chatId, "🔗 Режим: Google Drive", { reply_markup: mainKeyboard(isAdmin) }); return json({ ok:true }); }
  if (textRaw === BTN_SENTI) { await setDriveMode(env, userId, false); await setLearnMode(env, userId, false); await sendPlain(env, chatId, "🤖 Режим: Senti",        { reply_markup: mainKeyboard(isAdmin) }); return json({ ok:true }); }

  // Learn toggle з перевірками
  if (textRaw === BTN_LEARN) {
    if ((env.LEARN_ENABLED || "on").toLowerCase() !== "on") {
      await sendPlain(env, chatId, "🧠 Learn вимкнено адміністратором.");
      return json({ ok:true });
    }
    if (!env.LEARN_BUCKET) {
      await sendPlain(env, chatId, "🧠 R2 LEARN_BUCKET не налаштовано. Відкрий /admin → Checklist.");
      return json({ ok:true });
    }
    const on = !(await getLearnMode(env, userId));
    await setLearnMode(env, userId, on, 3600);
    const note = on
      ? "🧠 Learn-режим увімкнено на 1 годину.\nНадішли посилання або текст — я додам у «Learn». Також можна відкрити панель:"
      : "🧠 Learn-режим вимкнено.";
    await sendPlain(env, chatId, note, {
      reply_markup: { inline_keyboard: [[{ text: "🧠 Open Learn", url: abs(env, "/admin/learn") }]] }
    });
    return json({ ok:true });
  }

  const driveMode = await getDriveMode(env, userId);

  // 1) Voice
  if (msg?.voice) { await handleVoiceSTT(env, chatId, userId, msg, lang); return json({ ok: true }); }

  // 2) Drive збереження
  if (driveMode && (msg?.photo || msg?.document || msg?.video || msg?.audio || msg?.voice || msg?.video_note)) {
    await handleIncomingMedia(env, chatId, userId, msg, lang);
    return json({ ok: true });
  }

  // 3) Фото → Vision describe (+кнопка місця)
  if (!driveMode && msg?.photo) {
    await handleVisionMedia(env, chatId, userId, msg, lang, textRaw);
    return json({ ok: true });
  }

  // 4) Текст із Learn-поглинанням
  if (await handleTextWithLearnAndDialog(env, chatId, userId, textRaw, isAdmin, lang)) {
    return json({ ok: true });
  }

  // 5) «Де це?» по останньому фото (у тексті)
  const askPlace = /\b(що\s+це\s+за\s+місце|де\s+це|what\s+place\s+is\s+this|where\s+is\s+this)\b/iu;
  if (askPlace.test(textRaw)) {
    const lastUrl = await env.STATE_KV.get(KV.lastPhotoUrl(chatId));
    if (lastUrl) {
      try {
        pulseTyping(env, chatId);
        const systemHint = await buildSystemHint(env, chatId, userId, lang);
        const answer = await visionPlace(env, { imageUrl: lastUrl, lang, systemHint });
        await sendPlain(env, chatId, `📍 ${answer}`);
      } catch {
        await sendPlain(env, chatId, "Не впевнений у локації цього фото. Можу описати, якщо надішлеш ще раз.");
      }
      return json({ ok: true });
    }
  }

  // 6) Дата/час
  if (dateIntent(textRaw)) { await replyCurrentDate(env, chatId, lang); return json({ ok: true }); }
  if (timeIntent(textRaw)) { await replyCurrentTime(env, chatId, lang); return json({ ok: true }); }

  // 7) Погода
  if (/^\s*(погода|weather)\b/i.test(textRaw)) {
    const loc = await getUserLocation(env, userId);
    if (!loc) {
      await sendPlain(env, chatId, t(lang, "ask_location") || "Надішли, будь ласка, геолокацію, щоб показати погоду.", { reply_markup: askLocationKeyboard(lang) });
      return json({ ok: true });
    }
    const summary = await weatherSummaryByCoords(env, { lat: loc.latitude, lon: loc.longitude, lang }).catch(() => null);
    await sendPlain(env, chatId, summary || t(lang, "weather_fail") || "Не вдалося отримати погоду.");
    return json({ ok: true });
  }

  // 8) Діалог за замовчуванням
  await finishDialog(env, chatId, userId, textRaw, isAdmin, lang, msg);
  return json({ ok: true });
}

/* ───────────── Worker export ───────────── */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.endsWith("/webhook")) return handleTelegramWebhook(req, env);
    return new Response("OK", { status: 200 });
  }
};