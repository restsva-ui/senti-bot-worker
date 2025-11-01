// src/routes/webhook.js
// rev4.2 — Voice lang lock, Vision strict UA/locale, landmarks → Google Maps link, UA TTS mapping.
//
// - STT → lang: беремо з transcribeVoice() і фіксуємо для LLM та TTS.
// - Vision: строгий "ONLY in <lang>" + авто-перепис, якщо треба. Підказка моделі додати "MAPS: ...".
// - Після Vision: якщо знайдено "MAPS: ..." → додаємо лінк на Google Maps пошук.
// - TTS: chooseVoice() by language, sendAudio MP3 через CF @cf/myshell-ai/melotts.
// - Text answers: жорстко тримаємо мову користувача; озвучуємо, якщо VOICE_REPLY_DEFAULT="on".

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
import { enqueueLearn, getRecentInsights, listQueued } from "../lib/kvLearnQueue.js";
import { transcribeVoice } from "../lib/speechRouter.js";
import { dateIntent, timeIntent, replyCurrentDate, replyCurrentTime } from "../apis/time.js";
import { weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords } from "../apis/weather.js";
import { setUserLocation, getUserLocation } from "../lib/geo.js";

/* ───────────── Telegram helpers & UI ───────────── */
const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_LEARN,
  mainKeyboard, ADMIN, energyLinks, sendPlain, parseAiCommand,
  askLocationKeyboard
} = TG;

const KV = { learnMode: (uid) => `learn:mode:${uid}` };

/* typing pulse */
async function sendTyping(env, chatId) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" })
    });
  } catch {}
}
function pulseTyping(env, chatId, times = 4, intervalMs = 4000) {
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
    if (["heic", "heix", "mif1"].includes(f)) return "image/heic";
    if (["avif", "avis"].includes(f)) return "image/avif";
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
  const map = { uk: "українською", ru: "російською", en: "English", de: "Deutsch", fr: "français" };
  return map[c] || "українською";
}
function chooseVoice(env, lang = "uk") {
  const key = `VOICE_SPEAKER_${String(lang).toUpperCase()}`;
  const override = (env[key] || "").trim();
  if (override) return override;
  const v = (env.VOICE_SPEAKER || "").trim();
  if (v && v.toLowerCase() !== "auto") return v;
  const byLang = { uk: "oleksandr", ru: "sergei", en: "angus", de: "bernd", fr: "julie" };
  return byLang[String(lang).toLowerCase()] || "angus";
}
/* ───────────── Vision (strict language + landmarks) ───────────── */
function extractMapsQuery(text = "") {
  const m = String(text || "").match(/^\s*(?:MAPS?|LOCATION|PLACE)\s*:\s*(.+)$/im);
  return m ? m[1].trim() : null;
}
function buildMapsUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

async function visionDescribe(env, { imageUrl, userPrompt = "", lang = "uk", systemHint }) {
  const rawOrder = String(
    env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "@cf/meta/llama-3.2-11b-vision-instruct"
  ).trim();
  const modelOrder = filterVisionOrder(rawOrder);

  const { b64, mime } = await fetchToBase64WithMime(imageUrl, env.FORCE_IMAGE_TYPE || "image/jpeg");
  const langName = langNameFor(lang);
  const task = `Опиши зображення коротко і по суті. Відповідай **лише ${langName}**.
Якщо на фото є текст іншою мовою — коротко **передай зміст ${langName}**.
Якщо ти впевнено впізнаєш визначне місце або адресу, додай ОКРЕМИМ рядком:
MAPS: <коротка назва місця, місто, країна>.`;

  const prompt = userPrompt ? `${task}\n\nДодатковий контекст від користувача: «${userPrompt}».` : task;

  const strongSystem =
    (systemHint ? `${systemHint}\n\n` : "") +
    `STRICT LANGUAGE POLICY: Answer ONLY in ${langName}. Do not switch languages. Return MAPS: line only if highly confident.`;

  const out = await askVision(
    env,
    modelOrder,
    prompt,
    { systemHint: strongSystem, imageBase64: b64, imageMime: mime, temperature: 0.2 }
  );
  return String(out || "").trim();
}

/* ===== Learn helpers (admin-only) ======================================== */
function extractFirstUrl(text = "") { const m = String(text || "").match(/https?:\/\/\S+/i); return m ? m[0] : null; }
async function getLearnMode(env, userId) { try { return (await env.STATE_KV.get(`learn:mode:${userId}`)) === "on"; } catch { return false; } }
async function setLearnMode(env, userId, on) { try { await env.STATE_KV.put(`learn:mode:${userId}`, on ? "on" : "off"); } catch {} }

/* Drive-режим (збереження медіа) */
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
  if (msg.document) { const d = msg.document; return { type: "document", file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` }; }
  if (msg.video)    { const v = msg.video;    return { type: "video",    file_id: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4` }; }
  if (msg.audio)    { const a = msg.audio;    return { type: "audio",    file_id: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3` }; }
  if (msg.voice)    { const v = msg.voice;    return { type: "voice",    file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` }; }
  if (msg.video_note){const v = msg.video_note;return{ type:"video_note", file_id: v.file_id, name: `videonote_${v.file_unique_id}.mp4`};}
  return pickPhoto(msg);
}
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

/* Vision-режим */
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
    const systemHint = await buildSystemHint(env, chatId, userId, lang);
    let resp = await visionDescribe(env, {
      imageUrl: url,
      userPrompt: caption,
      lang,
      systemHint
    });

    // Якщо раптом відповідь не мовою користувача — переписуємо
    const detected = detectFromText(resp);
    if (detected && detected !== lang) {
      const langName = langNameFor(lang);
      const fixPrompt = `Rewrite the description ONLY in ${langName}, concise, no preface.`;
      resp = (await think(env, fixPrompt + "\n\n" + resp, { systemHint }))?.trim() || resp;
    }

    // Витягуємо MAPS: ... → даємо клікабельний лінк
    const mq = extractMapsQuery(resp);
    if (mq) {
      const maps = buildMapsUrl(mq);
      resp += `\n\n📍 ${mq}\n${maps}`;
    }

    await sendPlain(env, chatId, `🖼️ ${resp}`);
  } catch (e) {
    const raw = String(env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "").trim();
    const filtered = filterVisionOrder(raw);
    if (ADMIN(env, userId)) {
      await sendPlain(env, chatId, `❌ Vision error: ${String(e?.message || e).slice(0, 300)}\n(modelOrder raw: ${raw || "n/a"})\n(modelOrder used: ${filtered})`);
    } else {
      const connectUrl = abs(env, "/auth/drive");
      await sendPlain(env, chatId,
        "Поки що не можу аналізувати фото. Можу зберегти його у Google Drive — натисни «Google Drive».",
        { reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn") || "Підключити Drive", url: connectUrl }]] } }
      );
    }
  }
  return true;
}

/* ───────────── TTS (Cloudflare → Telegram sendAudio) ───────────── */
async function cfRunTTS(env, text, lang = "uk") {
  const acc = env.CF_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!acc || !token) throw new Error("tts: CF creds missing");

  const order = String(env.TTS_ORDER || "@cf/myshell-ai/melotts").split(",").map(s => s.trim()).filter(Boolean);
  const errs = [];
  for (const model of order) {
    try {
      const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/${model}`;
      const body = { text, voice: chooseVoice(env, lang), format: "mp3", language: lang };

      const r = await fetch(url, { method: "POST", headers: { "Authorization": `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
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
    } catch (e) {
      errs.push(`${model}: ${String(e.message || e)}`);
      continue;
    }
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
  } catch (_) { /* текст уже надіслано — мовчки ігноруємо */ }
}
/* Voice/STT */
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
    const stt = await transcribeVoice(env, url);
    const sttText = stt?.text || "";
    const sttLang = stt?.lang && ["uk","ru","en","de","fr"].includes(stt.lang) ? stt.lang : lang;

    await pushTurn(env, userId, "user", sttText);
    await autoUpdateSelfTune(env, userId, sttLang).catch(() => {});

    const systemHint = await buildSystemHint(env, chatId, userId, sttLang);
    const name = await getPreferredName(env, msg);
    const { short, full } = await callSmartLLM(env, sttText, {
      lang: sttLang, name, systemHint, expand: false, adminDiag: ADMIN(env, userId)
    });

    await pushTurn(env, userId, "assistant", full);
    await sendPlain(env, chatId, short);

    if ((env.VOICE_REPLY_DEFAULT || "off").toLowerCase() === "on") {
      await synthAndSendAudio(env, chatId, short, sttLang);
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
    /я\s+(являюсь|есть)\s+(ии|искусственн|языков)/i.test(out) ||
    /ich bin (ein|eine) (ki|sprachmodell)/i.test(out) ||
    /je suis (une|un) (ia|mod[èe]le de langue)/i.test(out)
  );
}
function stripProviderSignature(s = "") { return String(s).replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "").trim(); }
function guessEmoji(text = "") { const x = text.toLowerCase(); if (x.includes("машин")||x.includes("car"))return"🚗"; if(x.includes("світл")||x.includes("light"))return"☀️"; if(x.includes("вода")||x.includes("water"))return"💧"; return "💡"; }
function looksLikeModelDump(s=""){const x=s.toLowerCase();return /here(?:'|)s a breakdown|model (aliases|mappings|configurations)/i.test(x)||/gemini-?2\.5|openrouter|deepseek|llama/i.test(x);}
function limitMsg(s,m=220){if(!s)return s;return s.length<=m?s:s.slice(0,m-1);}
function chunkText(s,size=3500){const out=[];let t=String(s||"");while(t.length){out.push(t.slice(0,size));t=t.slice(size);}return out;}

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
    new RegExp(`\\bich\\s+hei(?:s|ß)e\\s+${NAME_RX}`, "iu"),
    new RegExp(`\\bje\\s+m'?appelle\\s+${NAME_RX}`, "iu")
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
    ? `You are Senti — a thoughtful, empathetic assistant. **Respond ONLY in ${langName}**. Keep it structured, concise, and helpful.`
    : `You are Senti. **Answer ONLY in ${langName}**, 1–3 короткі фрази, без зайвого вступу.`;

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
  // Заборона самопрезентації як AI
  if (revealsAiSelf(out)) {
    const fix = `Rewrite the answer as Senti. Do NOT mention being an AI/model or any company. Keep it ${langName}, коротко.`;
    let cleaned = modelOrder ? await askAnyModel(env, modelOrder, fix, { systemHint }) : await think(env, fix, { systemHint });
    cleaned = stripProviderSignature((cleaned || "").trim());
    if (cleaned) out = cleaned;
  }
  // Жорстка нормалізація мови
  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const force = `STRICT LANGUAGE MODE: Respond ONLY in ${langName}. Rewrite the previous answer in ${langName} without extra preface.`;
    let fixed = modelOrder ? await askAnyModel(env, modelOrder, force, { systemHint }) : await think(env, force, { systemHint });
    fixed = stripProviderSignature((fixed || "").trim());
    if (fixed) out = fixed;
  }

  if (!/^[\p{Emoji}\p{Extended_Pictographic}]/u.test(out || "")) {
    out = `${guessEmoji(userText)} ${out}`;
  }

  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}

/* ───────────── MAIN ───────────── */
export async function handleTelegramWebhook(req, env) {
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    const expected = env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "";
    if (expected && sec !== expected) return json({ ok: false, error: "unauthorized" }, { status: 401 });
  } else {
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  let update; try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }
  const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;
  const userId = msg?.from?.id || update?.callback_query?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();

  let lang = pickReplyLanguage(msg, textRaw);
  const safe = async (fn) => { try { await fn(); } catch (e) { if (isAdmin) await sendPlain(env, chatId, `❌ Error: ${String(e?.message || e).slice(0, 200)}`); else await sendPlain(env, chatId, t(lang, "default_reply")); } };

  // Location
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    const okMap = {
      uk: "✅ Локацію збережено. Тепер я показуватиму погоду для вашого місця.",
      ru: "✅ Локация сохранена. Теперь смогу показывать погоду для вашего места.",
      en: "✅ Location saved. I can now show weather for your area.",
      de: "✅ Standort gespeichert. Ich kann dir jetzt Wetter für deinen Ort zeigen.",
      fr: "✅ Position enregistrée. Je peux maintenant afficher la météo pour ta zone.",
    };
    const ok = okMap[(msg?.from?.language_code || lang || "uk").slice(0,2)] || okMap.uk;
    await sendPlain(env, chatId, ok, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  if (textRaw === "/start") {
    await safe(async () => {
      const profileLang = (msg?.from?.language_code || "").slice(0, 2).toLowerCase();
      const startLang = ["uk", "ru", "en", "de", "fr"].includes(profileLang) ? profileLang : lang;
      const name = await getPreferredName(env, msg);
      await sendPlain(env, chatId, `${t(startLang, "hello_name", name)} ${t(startLang, "how_help")}`, { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // mode toggles
  if (textRaw === BTN_DRIVE || /^(google\s*drive)$/i.test(textRaw)) { await setDriveMode(env, userId, true); return json({ ok: true }); }
  if (textRaw === BTN_SENTI || /^(senti|сенті)$/i.test(textRaw)) { await setDriveMode(env, userId, false); return json({ ok: true }); }

  // /admin (скорочено)
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const mo = String(env.MODEL_ORDER || "").trim();
      const rawVision = String(env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "").trim();
      const usedVision = filterVisionOrder(rawVision);
      const lines = [
        t(lang, "admin_header"),
        `MODEL_ORDER: ${mo || "(not set)"}`,
        `VISION_ORDER raw: ${rawVision || "(not set)"}`,
        `VISION_ORDER used: ${usedVision}`,
      ];
      await sendPlain(env, chatId, lines.join("\n"));
    });
    return json({ ok: true });
  }