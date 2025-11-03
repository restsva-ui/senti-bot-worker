// src/routes/webhook.js
// (rev) Без вітального відео; тихе перемикання режимів; фікс мови на /start;
// перевірка підключення Google Drive; дружній фолбек для медіа в Senti;
// авто-самотюнінг стилю (мовні профілі) через selfTune.
// (upd) Vision через каскад моделей (мультимовний) + base64 із Telegram файлів.
// (new) Vision Memory у KV: зберігаємо останні 20 фото з описами.
// (fix) HTML-іконки (↗︎) у відповідях Vision + parse_mode="HTML" тільки за потреби.
// (use) Фото-пам’ять вливається у SystemHint (останні 2–3 короткі описи).

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune, autoUpdateSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage, detectFromText } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import { enqueueLearn, listQueued, getRecentInsights } from "../lib/kvLearnQueue.js";
import { dateIntent, timeIntent, replyCurrentDate, replyCurrentTime } from "../apis/time.js";
import { weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords } from "../apis/weather.js";
import { setUserLocation, getUserLocation } from "../lib/geo.js";

import { describeImage } from "../flows/visionDescribe.js";
import { detectLandmarks, formatLandmarkLines } from "../lib/landmarkDetect.js";

// ── Alias з tg.js ────────────────────────────────────────────────────────────
const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_LEARN,
  mainKeyboard, ADMIN, energyLinks, sendPlain, parseAiCommand,
  askLocationKeyboard
} = TG;

// ── Ключі в STATE_KV (тільки для Learn toggle) ──────────────────────────────
const KV = {
  learnMode: (uid) => `learn:mode:${uid}`, // "on" | "off"
};

// ── Vision Memory у KV ──────────────────────────────────────────────────────
const VISION_MEM_KEY = (uid) => `vision:mem:${uid}`;
async function loadVisionMem(env, userId) {
  try {
    const raw = await (env.STATE_KV || env.CHECKLIST_KV)?.get(VISION_MEM_KEY(userId), "text");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
async function saveVisionMem(env, userId, entry) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  try {
    const arr = await loadVisionMem(env, userId);
    arr.unshift({
      id: entry.id,
      url: entry.url,
      caption: entry.caption || "",
      desc: entry.desc || "",
      ts: Date.now()
    });
    const trimmed = arr.slice(0, 20);
    await kv.put(VISION_MEM_KEY(userId), JSON.stringify(trimmed), { 
      expirationTtl: 60 * 60 * 24 * 180 
    });
  } catch {}
}

// ── Telegram UX helpers (typing) ────────────────────────────────────────────
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

// ── Binary → base64 helper (для Telegram файлів) ────────────────────────────
async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ── Media helpers ───────────────────────────────────────────────────────────
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
  if (msg.animation) {
    const a = msg.animation;
    return { type: "animation", file_id: a.file_id, name: a.file_name || `animation_${a.file_unique_id}.gif` };
  }
  return pickPhoto(msg);
}
async function tgFileUrl(env, file_id) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST", headers: { "content-type": "application/json" }, 
    body: JSON.stringify({ file_id })
  });
  const data = await r.json().catch(() => null);
  if (!data?.ok) throw new Error("getFile failed");
  const path = data.result?.file_path;
  if (!path) throw new Error("file_path missing");
  return `https://api.telegram.org/file/bot${token}/${path}`;
}

// ── DRIVE mode: handle incoming media for saving to Drive ───────────────────
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  let hasTokens = false;
  try {
    const tokens = await getUserTokens(env, userId);
    hasTokens = !!tokens;
  } catch {}
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

// Vision mode (multilingual + memory + HTML links)
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
  const imageBase64 = await urlToBase64(url);
  const prompt = caption || (lang.startsWith("uk") ? "Опиши, що на зображенні, коротко і по суті." : "Describe the image briefly and to the point.");

  try {
    // ⬇️ describeImage може повертати { isHtml: true } для ↗︎-лінків
    const { text, isHtml } = await describeImage(env, {
      chatId, tgLang: msg.from?.language_code, imageBase64, question: prompt,
      modelOrder: (env.VISION_ORDER || env.MODEL_ORDER_VISION || env.MODEL_ORDER || "@cf/meta/llama-3.2-11b-vision-instruct")
    });

    // save to vision memory
    await saveVisionMem(env, userId, { id: att.file_id, url, caption, desc: text });

    await sendPlain(env, chatId, `🖼️ ${text}`, {
      parse_mode: isHtml ? "HTML" : undefined,
      disable_web_page_preview: true
    });

    // Landmark detection after vision description
    const landmarks = await detectLandmarks(env, { description: text, ocrText: "", lang });
    if (landmarks?.length) {
      const landmarkLines = formatLandmarkLines(landmarks, lang).join("\n");
      await sendPlain(env, chatId, landmarkLines, { parse_mode: 'HTML', disable_web_page_preview: true });
    }
  } catch (e) {
    if (ADMIN(env, userId)) {
      await sendPlain(env, chatId, `❌ Vision error: ${String(e.message || e).slice(0, 180)}`);
    } else {
      const connectUrl = abs(env, "/auth/drive");
      await sendPlain(env, chatId,
        "Поки що не можу аналізувати фото. Можу зберегти його у Google Drive — натисни «Google Drive» або підключи Drive.",
        { reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn") || "Підключити Drive", url: connectUrl }]] } }
      );
    }
  }
  return true;
}

// ── SystemHint ───────────────────────────────────────────────────────────────
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

  // ⬇️ короткий блок з фото-пам’яті (останні 2–3)
  let visionBlock = "";
  try {
    const vm = await loadVisionMem(env, userId);
    if (vm?.length) {
      const items = vm.slice(0, 3).map(v => `• ${String(v.desc || v.caption || "").replace(/\s+/g," ").slice(0,120)}`);
      if (items.length) visionBlock = `[Фото-контекст]\n${items.join("\n")}`;
    }
  } catch {}

  const blocks = [core];
  if (statut) blocks.push(`[Статут/чеклист]\n${statut}`);
  if (tune) blocks.push(`[Self-Tune]\n${tune}`);
  if (insightsBlock) blocks.push(insightsBlock);
  if (visionBlock) blocks.push(visionBlock);
  if (dlg) blocks.push(dlg);
  return blocks.join("\n\n");
}

// ── Emoji + name helpers ──────────────────────────────────────────────────────
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

// ── User name parsing ─────────────────────────────────────────────────────────
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
  for (const r of patterns) {
    const m = s.match(r);
    if (m?.[1]) return m[1].trim();
  }
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

// ── Anti-disclosure "I am AI/LLM" & signatures strip ─────────────────────────
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

// ── Response helpers ───────────────────────────────────────────────────────────
function limitMsg(s, max = 220) { if (!s) return s; return s.length <= max ? s : s.slice(0, max - 1); }
function chunkText(s, size = 3500) { const out = []; let t = String(s || ""); while (t.length) { out.push(t.slice(0, size)); t = t.slice(size); } return out; }
function looksLikeModelDump(s = "") {
  const x = s.toLowerCase();
  return /here(?:'|)s a breakdown|model/i.test(x);
}

// ── Safe ask with fallback ─────────────────────────────────────────────────────
async function safeAsk(env, modelOrder, prompt, { systemHint } = {}) {
  if (modelOrder) {
    try {
      const out = await askAnyModel(env, modelOrder, prompt, { systemHint });
      return out;
    } catch (err) {
      console.error("Помилка askAnyModel:", err);
      try {
        const out = await think(env, prompt, { systemHint });
        return out;
      } catch (err2) {
        console.error("Помилка fallback think після askAnyModel:", err2);
        return null;
      }
    }
  }
  try {
    const out = await think(env, prompt, { systemHint });
    return out;
  } catch (err) {
    console.error("Помилка think (без modelOrder):", err);
    return null;
  }
}

async function callSmartLLM(env, userText, { lang, name, systemHint, expand, adminDiag = false }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();

  const control = expand
    ? `You are Senti — a thoughtful, emotionally intelligent assistant. Never say you're an AI, model, or a product of any company. Write ONLY in ${lang}; sound natural and human-like. Be warm and helpful. Split long ideas into short Telegram-friendly messages.`
    : `You are Senti — an independent, human-like assistant. Never mention being AI/GPT or created by anyone. Write ONLY in ${lang}. Keep it short and helpful (1–3 sentences). Answer directly without restating the question.`;

  const prompt = `Add one relevant emoji at the start if natural.
User (${name}) says: ${userText}
${control}`;

  // 1) first answer — safe
  let out = await safeAsk(env, modelOrder, prompt, { systemHint });
  if (!out) {
    const msg = "Виникла помилка при зверненні до AI. Спробуйте пізніше.";
    return { short: msg, full: msg };
  }
  out = stripProviderSignature((out || "").trim());

  // 2) technical dump → retry safe
  if (looksLikeModelDump(out)) {
    const retry = await safeAsk(env, modelOrder, prompt, { systemHint });
    if (retry) {
      out = stripProviderSignature((retry || out || "").trim());
    }
  }

  // 3) anti-self-disclosure
  if (revealsAiSelf(out)) {
    const fix = `Rewrite the previous answer as Senti. Do NOT mention being an AI/model or any company. Keep it in ${lang}, concise and natural.`;
    const cleaned = await safeAsk(env, modelOrder, fix, { systemHint });
    if (!cleaned) {
      const msg = "Виникла помилка при зверненні до AI. Спробуйте пізніше.";
      return { short: msg, full: msg };
    }
    out = stripProviderSignature((cleaned || out || "").trim());
  }

  // 4) emoji at start
  if (!looksLikeEmojiStart(out)) {
    const em = guessEmoji(userText);
    out = `${em} ${out}`;
  }

  // 5) language control
  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const hardPrompt = `STRICT LANGUAGE MODE: Respond ONLY in ${lang}. If the previous answer used another language, rewrite it now in ${lang}. Keep it concise.`;
    const fixed = await safeAsk(env, modelOrder, hardPrompt, { systemHint });
    if (!fixed) {
      const msg = "Виникла помилка при зверненні до AI. Спробуйте пізніше.";
      return { short: msg, full: msg };
    }
    const clean = stripProviderSignature((fixed || "").trim());
    out = looksLikeEmojiStart(clean) ? clean : `${guessEmoji(userText)} ${clean}`;
  }

  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}

// ── Admin helpers for Learn ────────────────────────────────────────────────────
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
async function listInsights(env, limit = 5) {
  try { return await getRecentInsights(env, { limit }) || []; } catch { return []; }
}// ── MAIN ────────────────────────────────────────────────────────────────────
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

  const safe = async (fn) => {
    try { await fn(); }
    catch (e) {
      if (isAdmin) await sendPlain(env, chatId, `❌ Error: ${String(e?.message || e).slice(0, 200)}`);
      else try { await sendPlain(env, chatId, t(lang, "default_reply")); } catch {}
    }
  };

  // Save location
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    const okMap = {
      uk: "✅ Локацію збережено. Тепер я можу показувати погоду для вашого місця.",
      ru: "✅ Локацию сохранено. Теперь я могу показывать погоду для вашего места.",
      en: "✅ Location saved. Now I can show weather for your area.",
      de: "✅ Standort gespeichert. Jetzt kann ich das Wetter für deinen Ort anzeigen.",
      fr: "✅ Emplacement enregistré. Maintenant je peux afficher la météo pour ta région."
    };
    await sendPlain(env, chatId, okMap[lang] || okMap.uk);
    return json({ ok: true });
  }

  // COMMANDS (parseAiCommand handles /start, /admin, etc)
  if (parseAiCommand(env, chatId, userId, textRaw, isAdmin)) {
    return json({ ok: true });
  }

  // Handle incoming media for drive
  const driveOn = (await getUserTokens(env, userId)) != null;
  const anyAtt = detectAttachment(msg);
  const hasAnyMedia = !!anyAtt || !!pickPhoto(msg);
  if (driveOn && hasAnyMedia) {
    if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
  }
  // Vision requests (photo with optional caption)
  if (pickPhoto(msg)) {
    if (await handleVisionMedia(env, chatId, userId, msg, lang, msg.caption)) return json({ ok: true });
  }

  // Default text → AI
  if (textRaw && !textRaw.startsWith("/")) {
    await safe(async () => {
      await rememberNameFromText(env, userId, textRaw);

      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
        return;
      }
      await spendEnergy(env, userId, need, "text");

      pulseTyping(env, chatId);

      // Push user to dialog memory
      await pushTurn(env, userId, "user", textRaw);
      await autoUpdateSelfTune(env, userId, lang).catch(() => {});

      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const name = await getPreferredName(env, msg);
      const expand = /\b(детальн|подроб|подробнее|more|details|expand|mehr|détails)\b/i.test(textRaw);
      const { short, full } = await callSmartLLM(env, textRaw, { lang, name, systemHint, expand, adminDiag: isAdmin });

      await pushTurn(env, userId, "assistant", full);

      const after = (cur.energy - need);
      // Code mode detection and formatting
      const codeMode = /\b(код|програм[ау]|script|code|function|функц\w+|скрипт)\b/i.test(textRaw);
      if (codeMode) {
        const codeMsg = `\`\`\`js\n${full}\n\`\`\``;
        await sendPlain(env, chatId, codeMsg, { parse_mode: "Markdown" });
      } else if (expand && full.length > short.length) {
        for (const ch of chunkText(full)) await sendPlain(env, chatId, ch);
      } else {
        await sendPlain(env, chatId, short);
      }

      if (after <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "low_energy_notice", after, links.energy));
      }
    });
    return json({ ok: true });
  }

  // Default greeting
  const profileLang = (msg?.from?.language_code || "").slice(0, 2).toLowerCase();
  const greetLang = ["uk", "ru", "en", "de", "fr"].includes(profileLang) ? profileLang : lang;
  const name = await getPreferredName(env, msg);
  await sendPlain(env, chatId, `${t(greetLang, "hello_name", name)} ${t(greetLang, "how_help")}`, {
    reply_markup: mainKeyboard(isAdmin)
  });
  return json({ ok: true });
}
