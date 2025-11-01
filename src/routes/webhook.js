// src/routes/webhook.js
// (rev3.1) FIX: balanced braces + final export end; no EOF error.
// (rev3) Vision: жорстке визначення image MIME (JPEG/PNG/WEBP/GIF/HEIC/AVIF).
// (rev2) Vision: фільтр порядку моделей (прибрано text-only).
// (rev1) STT: виклик через speechRouter (CF → Gemini), typing pulses.

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

const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_LEARN,
  mainKeyboard, ADMIN, energyLinks, sendPlain, parseAiCommand,
  askLocationKeyboard
} = TG;

const KV = { learnMode: (uid) => `learn:mode:${uid}` };

/* ── UX helpers ─────────────────────────────────────────────────────────── */
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

/* ── Binary → base64 + MIME helpers для Telegram файлів ─────────────────── */

function sniffImageMime(u8) {
  if (!u8 || u8.length < 12) return "";
  // JPEG: FF D8 FF
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47 &&
      u8[4] === 0x0d && u8[5] === 0x0a && u8[6] === 0x1a && u8[7] === 0x0a) return "image/png";
  // WEBP: "RIFF"...."WEBP"
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
      u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return "image/webp";
  // GIF: "GIF8"
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x38) return "image/gif";
  // ISOBMFF (HEIC/AVIF): "ftypheic"/"ftypavif"/"ftypmif1"
  if (u8[4] === 0x66 && u8[5] === 0x74 && u8[6] === 0x79 && u8[7] === 0x70) {
    const fourcc = String.fromCharCode(u8[8], u8[9], u8[10], u8[11]);
    if (fourcc === "heic" || fourcc === "heix" || fourcc === "mif1") return "image/heic";
    if (fourcc === "avif" || fourcc === "avis") return "image/avif";
  }
  return "";
}

function normalizeImageMime(headerCt, u8, fallback = "image/jpeg") {
  const ct = (headerCt || "").toLowerCase().trim();
  if (!ct || ct === "application/octet-stream") {
    return sniffImageMime(u8) || fallback;
  }
  // дехто ставить "image/jpg" — нормалізуємо до "image/jpeg"
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
  // → base64
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return { b64: btoa(s), mime };
}

/* ── Vision: фільтр порядку моделей ──────────────────────────────────────── */
function filterVisionOrder(orderStr = "") {
  const raw = String(orderStr || "").split(",").map(s => s.trim()).filter(Boolean);
  const keep = raw.filter(m =>
    /^cf:@cf\/meta\/llama-3\.2-11b-vision-instruct$/i.test(m) ||
    /^gemini:gemini-2\.0-.*(flash|vision).*$/i.test(m)
  );
  if (!keep.length) keep.push("cf:@cf/meta/llama-3.2-11b-vision-instruct");
  return keep.join(", ");
}

/* ── Vision через каскад моделей ─────────────────────────────────────────── */
async function visionDescribe(env, { imageUrl, userPrompt = "", lang = "uk", systemHint }) {
  const rawOrder = String(
    env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "@cf/meta/llama-3.2-11b-vision-instruct"
  ).trim();
  const modelOrder = filterVisionOrder(rawOrder);

  // Отримуємо реальний image MIME (без octet-stream)
  const { b64, mime } = await fetchToBase64WithMime(imageUrl, "image/jpeg");
  const prompt = `${userPrompt || "Опиши зображення коротко і по суті."} Відповідай ${lang.toUpperCase()} мовою.`;

  const out = await askVision(
    env,
    modelOrder,
    prompt,
    { systemHint, imageBase64: b64, imageMime: mime, temperature: 0.2 }
  );
  return String(out || "").trim();
}

/* ── Media helpers ───────────────────────────────────────────────────────── */
function pickPhoto(msg) {
  const arr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!arr?.length) return null;
  const ph = arr[arr.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document) {
    const d = msg.document;
    return { type: "document", file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` };
  }
  if (msg.video) {
    const v = msg.video;
    return { type: "video", file_id: v.file_id, name: v.file_name || `video_${v.file_unique_id}.mp4` };
  }
  if (msg.audio) {
    const a = msg.audio;
    return { type: "audio", file_id: a.file_id, name: a.file_name || `audio_${a.file_unique_id}.mp3` };
  }
  if (msg.voice) {
    const v = msg.voice;
    return { type: "voice", file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` };
  }
  if (msg.video_note) {
    const v = msg.video_note;
    return { type: "video_note", file_id: v.file_id, name: `videonote_${v.file_unique_id}.mp4` };
  }
  return pickPhoto(msg);
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
/* ===== Learn helpers (admin-only) ======================================== */
function extractFirstUrl(text = "") { const m = String(text || "").match(/https?:\/\/\S+/i); return m ? m[0] : null; }
async function getLearnMode(env, userId) { try { return (await env.STATE_KV.get(`learn:mode:${userId}`)) === "on"; } catch { return false; } }
async function setLearnMode(env, userId, on) { try { await env.STATE_KV.put(`learn:mode:${userId}`, on ? "on" : "off"); } catch {} }

/* Drive-режим (збереження медіа) */
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
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(lang, "need_energy_media", need, links.energy));
    return true;
  }
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
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
    return true;
  }
  await spendEnergy(env, userId, need, "vision");

  pulseTyping(env, chatId);

  const url = await tgFileUrl(env, att.file_id);
  const prompt = caption || "Опиши, що на зображенні, коротко і по суті.";

  try {
    const systemHint = await buildSystemHint(env, chatId, userId, lang);
    const resp = await visionDescribe(env, { imageUrl: url, userPrompt: prompt, lang, systemHint });
    await sendPlain(env, chatId, `🖼️ ${resp}`);
  } catch (e) {
    if (ADMIN(env, userId)) {
      const raw = String(env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "").trim();
      const filtered = filterVisionOrder(raw);
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

/* Voice/STT-режим */
async function handleVoiceSTT(env, chatId, userId, msg, lang) {
  if (!msg?.voice?.file_id) return false;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
    return true;
  }
  await spendEnergy(env, userId, need, "voice");

  pulseTyping(env, chatId);
  await sendPlain(env, chatId, "🎙️ Обробляю голос...");

  try {
    const url = await tgFileUrl(env, msg.voice.file_id);
    const { text: stt } = await transcribeVoice(env, url);

    await pushTurn(env, userId, "user", stt);
    await autoUpdateSelfTune(env, userId, lang).catch(() => {});

    const systemHint = await buildSystemHint(env, chatId, userId, lang);
    const name = await getPreferredName(env, msg);
    const { short, full } = await callSmartLLM(env, stt, { lang, name, systemHint, expand: false, adminDiag: ADMIN(env, userId) });

    await pushTurn(env, userId, "assistant", full);
    await sendPlain(env, chatId, short);
  } catch (e) {
    if (ADMIN(env, userId)) {
      await sendPlain(env, chatId, `❌ Error: STT providers failed | ${String(e?.message || e).slice(0, 220)}`);
    } else {
      await sendPlain(env, chatId, "На жаль, не вдалося розпізнати голос. Спробуй ще раз або напиши текстом 🙏");
    }
  }
  return true;
}

/* ── SystemHint / name utils ─────────────────────────────────────────────── */
async function buildSystemHint(env, chatId, userId, preferredLang) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId, { preferredLang }).catch(() => null);

  const core = `You are Senti — a thoughtful, self-improving assistant and companion.
- Never claim to be an AI, model, chatbot, or a product made by any company.
- Speak naturally and human-like with warmth and clarity.
- Prefer concise, practical answers; expand only when asked.`;

  let insightsBlock = "";
  try {
    const insights = await getRecentInsights(env, { limit: 5 });
    if (insights?.length) {
      const lines = insights.map(i => `• ${i.insight}${i.r2Key ? " [R2]" : ""}`);
      insightsBlock = `[Нещодавні знання]\n${lines.join("\n")}`;
    }
  } catch {}

  const blocks = [core];
  if (statut) blocks.push(`[Статут/чеклист]\n${statut}`);
  if (tune) blocks.push(`[Self-Tune]\n${tune}`);
  if (insightsBlock) blocks.push(insightsBlock);
  if (dlg) blocks.push(dlg);
  return blocks.join("\n\n");
}

function guessEmoji(text = "") {
  const tt = text.toLowerCase();
  if (tt.includes("колес") || tt.includes("wheel")) return "🛞";
  if (tt.includes("дзеркал") || tt.includes("mirror")) return "🪞";
  if (tt.includes("машин") || tt.includes("авто") || tt.includes("car")) return "🚗";
  if (tt.includes("вода") || tt.includes("рідина") || tt.includes("water")) return "💧";
  if (tt.includes("світл") || tt.includes("light")) return "☀️";
  if (tt.includes("електр") || tt.includes("струм")) return "⚡";
  return "💡";
}
function looksLikeEmojiStart(s = "") { try { return /^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(String(s)); } catch { return false; } }

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
const PROFILE_NAME_KEY = (uid) => `profile:name:${uid}`;
async function getPreferredName(env, msg) {
  const uid = msg?.from?.id;
  const kv = env?.STATE_KV;
  let v = null;
  try { v = await kv.get(PROFILE_NAME_KEY(uid)); } catch {}
  if (v) return v;
  return msg?.from?.first_name || msg?.from?.username || "друже";
}
async function rememberNameFromText(env, userId, text) {
  const name = tryParseUserNamedAs(text);
  if (!name) return null;
  try { await env.STATE_KV.put(PROFILE_NAME_KEY(userId), name); } catch {}
  return name;
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
function stripProviderSignature(s = "") {
  return String(s).replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "").trim();
}

function limitMsg(s, max = 220) { if (!s) return s; return s.length <= max ? s : s.slice(0, max - 1); }
function chunkText(s, size = 3500) { const out = []; let t = String(s || ""); while (t.length) { out.push(t.slice(0, size)); t = t.slice(size); } return out; }
function looksLikeModelDump(s = "") {
  const x = s.toLowerCase();
  return /here(?:'|)s a breakdown|model (aliases|mappings|configurations)/i.test(x) || /gemini-?2\.5|openrouter|deepseek|llama/i.test(x);
}

async function callSmartLLM(env, userText, { lang, name, systemHint, expand, adminDiag = false }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();

  const control = expand
    ? `You are Senti — a thoughtful, emotionally intelligent assistant. Never say you're an AI, model, or a product of any company. Write ONLY in ${lang}; sound natural and human-like. Be warm and helpful. Split long ideas into short Telegram-friendly messages.`
    : `You are Senti — an independent, human-like assistant. Never mention being AI/GPT or created by anyone. Write ONLY in ${lang}. Keep it short and helpful (1–3 sentences). Answer directly without restating the question.`;

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
    const fix = `Rewrite the previous answer as Senti. Do NOT mention being an AI/model or any company. Keep it in ${lang}, concise and natural.`;
    let cleaned = modelOrder
      ? await askAnyModel(env, modelOrder, fix, { systemHint })
      : await think(env, fix, { systemHint });
    cleaned = stripProviderSignature((cleaned || "").trim());
    if (cleaned) out = cleaned;
  }
  if (!/^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(out || "")) {
    const em = guessEmoji(userText);
    out = `${em} ${out}`;
  }

  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const hardPrompt = `STRICT LANGUAGE MODE: Respond ONLY in ${lang}. If the previous answer used another language, rewrite it now in ${lang}. Keep it concise.`;
    let fixed = modelOrder
      ? await askAnyModel(env, modelOrder, hardPrompt, { systemHint })
      : await think(env, hardPrompt, { systemHint });
    fixed = stripProviderSignature((fixed || "").trim());
    if (fixed) out = /^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(fixed) ? fixed : `${guessEmoji(userText)} ${fixed}`;
  }

  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}
/* ── Learn admin actions ─────────────────────────────────────────────────── */
async function runLearnNow(env) {
  const secret = env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || "";
  const u = new URL(abs(env, "/admin/learn/run"));
  if (secret) u.searchParams.set("s", secret);
  const r = await fetch(u.toString(), { method: "POST" });
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) throw new Error(`learn_run http ${r.status}`);
  if (ct.includes("application/json")) return await r.json();
  return { ok: true, summary: await r.text() };
}

/* ── MAIN ────────────────────────────────────────────────────────────────── */
export async function handleTelegramWebhook(req, env) {
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    const expected = env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || env.WEBHOOK_SECRET || "";
    if (expected && sec !== expected) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  let update;
  try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }

  const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;
  const userId = msg?.from?.id || update?.callback_query?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();

  let lang = pickReplyLanguage(msg, textRaw);
  const safe = async (fn) => { try { await fn(); } catch (e) { if (isAdmin) await sendPlain(env, chatId, `❌ Error: ${String(e?.message || e).slice(0, 200)}`); else try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {} } };

  // збереження гео
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    const okMap = {
      uk: "✅ Локацію збережено. Тепер я можу показувати погоду для вашого місця.",
      ru: "✅ Локация сохранена. Теперь я смогу показывать погоду для вашего места.",
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
      await sendPlain(env, chatId, `${t(startLang, "hello_name", name)} ${t(startLang, "how_help")}`, {
        reply_markup: mainKeyboard(isAdmin)
      });
    });
    return json({ ok: true });
  }

  // тихий перемикач режимів
  if (textRaw === BTN_DRIVE || /^(google\s*drive)$/i.test(textRaw)) { await setDriveMode(env, userId, true); return json({ ok: true }); }
  if (textRaw === BTN_SENTI || /^(senti|сенті)$/i.test(textRaw)) { await setDriveMode(env, userId, false); return json({ ok: true }); }

  // /admin
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const mo = String(env.MODEL_ORDER || "").trim();
      const hasGemini = !!(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY);
      const hasCF = !!(env.CLOUDFLARE_API_TOKEN && env.CF_ACCOUNT_ID);
      const hasOR = !!(env.OPENROUTER_API_KEY);
      const hasFreeBase = !!(env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL);
      const hasFreeKey = !!(env.FREE_LLM_API_KEY || env.FREE_API_KEY);

      const rawVision = String(env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "").trim();
      const usedVision = filterVisionOrder(rawVision);

      const lines = [
        t(lang, "admin_header"),
        `MODEL_ORDER: ${mo || "(not set)"}`,
        `VISION_ORDER raw: ${rawVision || "(not set)"}`,
        `VISION_ORDER used: ${usedVision}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${hasCF ? "✅" : "❌"}`,
        `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`
      ];

      const entries = mo ? mo.split(",").map(s => s.trim()).filter(Boolean) : [];
      if (entries.length) {
        const health = await getAiHealthSummary(env, entries);
        lines.push("\n— Health:");
        for (const h of health) {
          const light = h.cool ? "🟥" : (h.slow ? "🟨" : "🟩");
          const ms = h.ewmaMs ? `${Math.round(h.ewmaMs)}ms` : "n/a";
          lines.push(`${light} ${h.provider}:${h.model} — ewma ${ms}, fails ${h.failStreak || 0}`);
        }
      }
      const links = energyLinks(env, userId);
      const markup = { inline_keyboard: [
        [{ text: "📋 Відкрити Checklist", url: links.checklist }],
        [{ text: "🧠 Open Learn", url: links.learn } ],
      ]};
      await sendPlain(env, chatId, lines.join("\n"), { reply_markup: markup });
    });
    return json({ ok: true });
  }

  // Learn UI / тумблери / адмін
  if (textRaw === (BTN_LEARN || "Learn") || (isAdmin && textRaw === "/learn")) {
    if (!isAdmin) { await sendPlain(env, chatId, t(lang, "how_help"), { reply_markup: mainKeyboard(false) }); return json({ ok: true }); }
    await safe(async () => {
      let hasQueue = false;
      try { const r = await listQueued(env, { limit: 1 }); hasQueue = Array.isArray(r) ? r.length > 0 : Array.isArray(r?.items) ? r.items.length > 0 : false; } catch {}
      const links = energyLinks(env, userId);
      const hint = "🧠 Режим Learn.\nНадсилай посилання, файли або архіви — я додам у чергу, **якщо Learn увімкнено** (/learn_on).";
      const keyboard = [[{ text: "🧠 Відкрити Learn HTML", url: links.learn }]];
      if (hasQueue) keyboard.push([{ text: "🧠 Прокачай мозок", url: abs(env, `/admin/learn/run?s=${encodeURIComponent(env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || "")}`) }]);
      await sendPlain(env, chatId, hint, { reply_markup: { inline_keyboard: keyboard } });
    });
    return json({ ok: true });
  }
  if (isAdmin && textRaw === "/learn_on")  { await setLearnMode(env, userId, true);  await sendPlain(env, chatId, "🟢 Learn-режим увімкнено.");  return json({ ok: true }); }
  if (isAdmin && textRaw === "/learn_off") { await setLearnMode(env, userId, false); await sendPlain(env, chatId, "🔴 Learn-режим вимкнено.");  return json({ ok: true }); }

  // Learn enqueue (адмін коли Learn ON)
  if (isAdmin && await getLearnMode(env, userId)) {
    const urlInText = extractFirstUrl(textRaw);
    if (urlInText) { await enqueueLearn(env, String(userId), { url: urlInText, name: urlInText }); await sendPlain(env, chatId, "✅ Додано в чергу Learn."); return json({ ok: true }); }
    const anyAtt = detectAttachment(msg);
    if (anyAtt?.file_id) {
      const fUrl = await tgFileUrl(env, anyAtt.file_id);
      await enqueueLearn(env, String(userId), { url: fUrl, name: anyAtt.name || "file" });
      await sendPlain(env, chatId, "✅ Додано в чергу Learn.");
      return json({ ok: true });
    }
  }

  /* ── MEDIA ROUTING ─────────────────────────────────────────────────────── */
  try {
    const driveOn = await getDriveMode(env, userId);
    const hasAnyMedia = !!detectAttachment(msg) || !!pickPhoto(msg);

    if (driveOn && hasAnyMedia) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
    }

    if (!driveOn && msg?.voice) {
      if (await handleVoiceSTT(env, chatId, userId, msg, lang)) return json({ ok: true });
    }
    if (!driveOn && pickPhoto(msg)) {
      if (await handleVisionMedia(env, chatId, userId, msg, lang, msg?.caption)) return json({ ok: true });
    }
    if (!driveOn && (msg?.video || msg?.document || msg?.audio || msg?.video_note)) {
      await sendPlain(env, chatId,
        "Поки що не аналізую такі файли в цьому режимі. Хочеш — увімкни збереження у Google Drive кнопкою «Google Drive».",
        { reply_markup: mainKeyboard(ADMIN(env, userId)) }
      );
      return json({ ok: true });
    }
  } catch (e) {
    if (ADMIN(env, userId)) await sendPlain(env, chatId, `❌ Media error: ${String(e).slice(0, 180)}`);
    else await sendPlain(env, chatId, t(lang, "default_reply"));
    return json({ ok: true });
  }

  /* ── QUICK INTENTS (текст) ─────────────────────────────────────────────── */
  if (textRaw) {
    // збереження імені з фраз "мене звати ..."
    await rememberNameFromText(env, userId, textRaw).catch(() => {});
    // дата / час
    if (dateIntent(textRaw)) { await replyCurrentDate(env, chatId, lang); return json({ ok: true }); }
    if (timeIntent(textRaw)) { await replyCurrentTime(env, chatId, lang); return json({ ok: true }); }
    // погода
    const win = weatherIntent(textRaw);
    if (win) {
      const loc = await getUserLocation(env, userId).catch(() => null);
      if (loc?.lat && loc?.lon) {
        await weatherSummaryByCoords(env, chatId, lang, loc.lat, loc.lon);
      } else {
        await sendPlain(env, chatId, t(lang, "ask_location") || "Поділись локацією, будь ласка 👇", { reply_markup: askLocationKeyboard() });
      }
      return json({ ok: true });
    }
  }

  /* ── DEFAULT: текст → LLM ──────────────────────────────────────────────── */
  const text = textRaw;
  if (text) {
    try {
      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
        return json({ ok: true });
      }
      await spendEnergy(env, userId, need, "text");

      pulseTyping(env, chatId);

      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const name = await getPreferredName(env, msg);

      // /expand → довша відповідь
      const isExpand = /^\/expand\b/i.test(text);
      const userQuery = isExpand ? text.replace(/^\/expand\b/i, "").trim() : text;

      const { short, full } = await callSmartLLM(env, userQuery, { lang, name, systemHint, expand: isExpand, adminDiag: isAdmin });
      await pushTurn(env, userId, "user", userQuery);
      await pushTurn(env, userId, "assistant", full);

      // довгі відповіді — порізати на частини
      const chunks = chunkText(short, 3800);
      for (const ch of chunks) await sendPlain(env, chatId, ch);
    } catch (e) {
      if (isAdmin) await sendPlain(env, chatId, `❌ LLM error: ${String(e?.message || e).slice(0, 240)}`);
      else await sendPlain(env, chatId, t(lang, "default_reply"));
    }
    return json({ ok: true });
  }

  // якщо нічого не зрозуміли:
  await sendPlain(env, chatId, t(lang, "how_help") || "Як можу допомогти?", { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}