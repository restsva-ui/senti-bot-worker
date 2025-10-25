// src/routes/webhook.js
// (rev CODE-ONE++) Senti як одна особистість, ТИХІ перемикачі Senti/Drive/Code,
// Code-mode однією кнопкою (повний код, з контекстом), безкоштовні моделі TEXT/CODE,
// Vision через CF, авто-тюн, енергія, довгі відповіді — через TG.sendPlain.

/* ───────────────────── ІМПОРТИ ───────────────────── */
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

/* ───────────────────── АЛІАСИ З TG ───────────────────── */
const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_LEARN, BTN_CODE,
  mainKeyboard, ADMIN, energyLinks, sendPlain,
  askLocationKeyboard
} = TG;

/* ───────────────────── KV-КЛЮЧІ ───────────────────── */
const KV = {
  learnMode:   (uid) => `learn:mode:${uid}`,   // "on" | "off"
  codeMode:    (uid) => `mode:code:${uid}`,    // "on" | "off"
  profileName: (uid) => `profile:name:${uid}`,
};

/* ───────────────────── UX: typing ───────────────────── */
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

/* ───────────────────── CF Vision (безкоштовно) ───────────────────── */
async function cfVisionDescribe(env, imageUrl, userPrompt = "", lang = "uk") {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CF_ACCOUNT_ID) throw new Error("CF credentials missing");
  const model = env.CF_VISION_MODEL || "@cf/llama-3.2-11b-vision-instruct";
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`;

  const messages = [{
    role: "user",
    content: [
      { type: "input_text", text: `${userPrompt || "Опиши зображення стисло."} Відповідай мовою: ${lang}.` },
      { type: "input_image", image_url: imageUrl }
    ]
  }];

  const r = await fetch(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages })
  });

  const data = await r.json().catch(() => null);
  if (!data || !data.success) {
    const msg = data?.errors?.[0]?.message || `CF vision failed (HTTP ${r.status})`;
    throw new Error(msg);
  }
  const result = data.result?.response || data.result?.output_text || data.result?.text || "";
  return String(result || "").trim();
}

/* ───────────────────── Media helpers ───────────────────── */
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

/* ───────────────────── Learn helpers ───────────────────── */
function extractFirstUrl(text = "") {
  const m = String(text || "").match(/https?:\/\/\S+/i);
  return m ? m[0] : null;
}
async function getLearnMode(env, userId) {
  try { return (await env.STATE_KV.get(KV.learnMode(userId))) === "on"; } catch { return false; }
}
async function setLearnMode(env, userId, on) {
  try { await env.STATE_KV.put(KV.learnMode(userId), on ? "on" : "off"); } catch {}
}

/* ───────────────────── Code-mode KV ───────────────────── */
async function getCodeMode(env, userId) {
  try { return (await env.STATE_KV.get(KV.codeMode(userId))) === "on"; } catch { return false; }
}
async function setCodeMode(env, userId, on) {
  try { await env.STATE_KV.put(KV.codeMode(userId), on ? "on" : "off"); } catch {}
}

/* ───────────────────── Drive-режим ───────────────────── */
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  // Перевірка підключення Drive
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

/* ───────────────────── Vision-режим ───────────────────── */
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
    const resp = await cfVisionDescribe(env, url, prompt, lang);
    await sendPlain(env, chatId, `🖼️ ${resp}`);
  } catch {
    const connectUrl = abs(env, "/auth/drive");
    await sendPlain(
      env,
      chatId,
      "Поки що не можу аналізувати фото. Можу зберегти його у Google Drive — натисни «Google Drive» або підключи Drive.",
      { reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn") || "Підключити Drive", url: connectUrl }]] } }
    );
  }
  return true;
}

/* ───────────────────── SystemHint ───────────────────── */
async function buildSystemHint(env, chatId, userId, preferredLang, { code }) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId, { preferredLang }).catch(() => null);

  const baseCore = `You are Senti — a thoughtful, self-improving single-persona assistant and companion.
- Never claim to be an AI, model, chatbot, or a product made by any company.
- Speak naturally and human-like with warmth and clarity.
- Prefer concise, practical answers; expand only when asked.`;

  const codeCore = code ? `
- You are in CODE MODE: produce COMPLETE, runnable code with clear project structure, file boundaries, and step-by-step reasoning kept internal; do not mention being a model; keep responses in ${preferredLang}.` : "";

  let insightsBlock = "";
  try {
    const insights = await getRecentInsights(env, { limit: 5 });
    if (insights?.length) {
      const lines = insights.map(i => `• ${i.insight}${i.r2Key ? " [R2]" : ""}`);
      insightsBlock = `[Нещодавні знання]\n${lines.join("\n")}`;
    }
  } catch {}

  const blocks = [baseCore + codeCore];
  if (statut) blocks.push(`[Статут/чеклист]\n${statut}`);
  if (tune) blocks.push(`[Self-Tune]\n${tune}`);
  if (insightsBlock) blocks.push(insightsBlock);
  if (dlg) blocks.push(dlg);
  return blocks.join("\n\n");
}

/* ───────────────────── Ім’я користувача ───────────────────── */
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
  try { await env.STATE_KV.put(KV.profileName(userId), name); } catch {}
  return name;
}
async function getPreferredName(env, msg) {
  const uid = msg?.from?.id;
  const kv = env?.STATE_KV;
  let v = null;
  try { v = await kv.get(KV.profileName(uid)); } catch {}
  if (v) return v;
  return msg?.from?.first_name || msg?.from?.username || "друже";
}

/* ───────────────────── Фільтри/санітарія ───────────────────── */
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
function limitMsg(s, max = 220) {
  if (!s) return s; return s.length <= max ? s : s.slice(0, max - 1);
}
function looksLikeModelDump(s = "") {
  const x = s.toLowerCase();
  return /here(?:'|)s a breakdown|model (aliases|mappings|configurations)/i.test(x) || /gemini-?2\.5|openrouter|deepseek|llama/i.test(x);
}

/* ───────────────────── Порядок моделей ───────────────────── */
function normalizeOrder(env, order) {
  const modelId = env.FREE_API_MODEL || "meta-llama/llama-4-scout:free";
  return String(order || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(tok => (tok === "free" ? `free:${modelId}` : tok))
    .join(", ");
}
function pickModelOrder(env, { code }) {
  const textOrderEnv = env.MODEL_ORDER_TEXT || env.MODEL_ORDER || "";
  const codeOrderEnv = env.MODEL_ORDER_CODE || "";

  const DEF_TEXT = "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.1-8b-instruct, free:meta-llama/llama-4-scout:free";
  const DEF_CODE = "openrouter:qwen/qwen3-coder:free, cf:@cf/meta/llama-3.1-8b-instruct, free:meta-llama/llama-4-scout:free";

  const chosen = code ? (codeOrderEnv || DEF_CODE) : (textOrderEnv || DEF_TEXT);
  return normalizeOrder(env, chosen);
}

/* ───────────────────── LLM-виклик ───────────────────── */
async function callSmartLLM(env, userText, { lang, name, systemHint, expand, adminDiag = false }) {
  const control = expand
    ? `You are Senti — a thoughtful, emotionally intelligent single-persona assistant. Never say you're an AI, model, or a product of any company. Write ONLY in ${lang}. Be warm and helpful. Split long ideas into Telegram-friendly messages. When user asks for code, produce complete, runnable code with clear structure.`
    : `You are Senti — a single-persona assistant. Never mention being AI/GPT or created by anyone. Write ONLY in ${lang}. Keep it short and helpful (1–3 sentences). Answer directly.`;

  const prompt = `Add one relevant emoji at the start if natural.
User (${name}) says: ${userText}
${control}`;

  let out;
  try {
    out = await askAnyModel(env, String(env.MODEL_ORDER || "").trim(), prompt, { systemHint });
  } catch (e) {
    if (adminDiag) throw e;
    // останній шанс
    out = await think(env, prompt, { systemHint });
  }

  out = stripProviderSignature((out || "").trim());
  if (looksLikeModelDump(out)) {
    out = stripProviderSignature((await think(env, prompt, { systemHint }))?.trim() || out);
  }
  if (revealsAiSelf(out)) {
    const fix = `Rewrite the previous answer as Senti. Do NOT mention being an AI/model or any company. Keep it in ${lang}, concise and natural.`;
    let cleaned = await askAnyModel(env, String(env.MODEL_ORDER || "").trim(), fix, { systemHint }).catch(()=>null);
    if (!cleaned) cleaned = await think(env, fix, { systemHint }).catch(()=>null);
    cleaned = stripProviderSignature((cleaned || "").trim());
    if (cleaned) out = cleaned;
  }

  // Додамо базовий емодзі, якщо немає
  if (!/^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(out)) out = `💡 ${out}`;

  // Жорсткий режим мови (захист)
  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const hardPrompt = `STRICT LANGUAGE MODE: Respond ONLY in ${lang}. If the previous answer used another language, rewrite it now in ${lang}. Keep it concise.`;
    let fixed = await askAnyModel(env, String(env.MODEL_ORDER || "").trim(), hardPrompt, { systemHint }).catch(()=>null);
    if (!fixed) fixed = await think(env, hardPrompt, { systemHint }).catch(()=>null);
    fixed = stripProviderSignature((fixed || "").trim());
    if (fixed) out = /^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(fixed) ? fixed : `💡 ${fixed}`;
  }

  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}

/* ───────────────────── Адмін-хелпери ───────────────────── */
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

/* ───────────────────── MAIN ───────────────────── */
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

  // збереження геолокації
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

  // /start — тиха ініціалізація з клавіатурою
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

  /* ───── ТИХІ перемикачі (кнопки й слеш-команди) ───── */
  if (textRaw === BTN_DRIVE || /^(google\s*drive)$/i.test(textRaw) || /^\/drive\b/i.test(textRaw)) {
    await setDriveMode(env, userId, true);
    return json({ ok: true });
  }
  if (textRaw === BTN_SENTI || /^(senti|сенті)$/i.test(textRaw) || /^\/senti\b/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodeMode(env, userId, false); // вихід з code-mode при поверненні до Senti
    return json({ ok: true });
  }
  if (textRaw === BTN_CODE || /^code$/i.test(textRaw) || /^\/code\b/i.test(textRaw)) {
    await setCodeMode(env, userId, true);
    return json({ ok: true });
  }

  /* ───── /admin ───── */
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const mo = String(env.MODEL_ORDER || "").trim();
      const hasGemini = !!(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY);
      const hasCF = !!(env.CLOUDFLARE_API_TOKEN && env.CF_ACCOUNT_ID);
      const hasOR = !!(env.OPENROUTER_API_KEY);
      const hasFreeBase = !!(env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL);
      const hasFreeKey = !!(env.FREE_LLM_API_KEY || env.FREE_API_KEY);

      const code = await getCodeMode(env, userId);
      const lines = [
        t(lang, "admin_header"),
        `MODEL_ORDER runtime: ${mo || "(not set)"}`,
        `MODEL_ORDER_TEXT: ${env.MODEL_ORDER_TEXT || "(default Gemini→CF→free)"}`,
        `MODEL_ORDER_CODE: ${env.MODEL_ORDER_CODE || "(default QwenCoder(free)→CF→free)"}`,
        `Code-mode: ${code ? "ON" : "OFF"}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare: ${hasCF ? "✅" : "❌"}`,
        `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM: ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`
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
      await sendPlain(env, chatId, lines.join("\n"), { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  /* ───── Learn (адмін) ───── */
  if (textRaw === (BTN_LEARN || "Learn") || (isAdmin && textRaw === "/learn")) {
    if (!isAdmin) {
      await sendPlain(env, chatId, t(lang, "how_help"), { reply_markup: mainKeyboard(false) });
      return json({ ok: true });
    }
    await safe(async () => {
      let hasQueue = false;
      try {
        const r = await listQueued(env, { limit: 1 });
        hasQueue = Array.isArray(r) ? r.length > 0 : Array.isArray(r?.items) ? r.items.length > 0 : false;
      } catch {}
      const links = energyLinks(env, userId);
      const hint =
        "🧠 Режим Learn.\nНадсилай посилання, файли або архіви — я додам у чергу, **якщо Learn увімкнено** (/learn_on). " +
        "В HTML-інтерфейсі можна переглянути чергу й підсумки, а також запустити обробку.";
      const keyboard = [[{ text: "🧠 Відкрити Learn HTML", url: links.learn }]];
      if (hasQueue) {
        keyboard.push([{ text: "🧠 Прокачай мозок", url: abs(env, `/admin/learn/run?s=${encodeURIComponent(env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || "")}`) }]);
      }
      await sendPlain(env, chatId, hint, { reply_markup: { inline_keyboard: keyboard } });
    });
    return json({ ok: true });
  }
  if (isAdmin && textRaw === "/learn_on") {
    await setLearnMode(env, userId, true);
    await sendPlain(env, chatId, "🟢 Learn-режим увімкнено. Надіслані посилання/файли підуть у чергу.");
    return json({ ok: true });
  }
  if (isAdmin && textRaw === "/learn_off") {
    await setLearnMode(env, userId, false);
    await sendPlain(env, chatId, "🔴 Learn-режим вимкнено. Медіа знову обробляються як зазвичай (Drive/Vision).");
    return json({ ok: true });
  }
  if (isAdmin && textRaw.startsWith("/learn_add")) {
    const u = extractFirstUrl(textRaw);
    if (!u) { await sendPlain(env, chatId, "Дай посилання після команди, напр.: /learn_add https://..."); return json({ ok: true }); }
    await enqueueLearn(env, String(userId), { url: u, name: u });
    await sendPlain(env, chatId, "✅ Додано в чергу Learn.");
    return json({ ok: true });
  }
  if (isAdmin && textRaw === "/learn_run") {
    await safe(async () => {
      const res = await runLearnNow(env);
      const summary = String(res?.summary || "").trim();
      const out = summary
        ? `✅ Learn запущено.\n\nКороткий підсумок:\n${summary.slice(0, 1500)}`
        : "✅ Learn запущено. Підсумок збережено в адмін-панелі.";
      await sendPlain(env, chatId, out);
    });
    return json({ ok: true });
  }

  /* ───── MEDIA ROUTING ───── */
  try {
    const driveOn = await getDriveMode(env, userId);
    const hasAnyMedia = !!detectAttachment(msg) || !!pickPhoto(msg);

    if (driveOn && hasAnyMedia) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
    }
    if (!driveOn && pickPhoto(msg)) {
      if (await handleVisionMedia(env, chatId, userId, msg, lang, msg?.caption)) return json({ ok: true });
    }
    if (!driveOn && (msg?.video || msg?.document || msg?.audio || msg?.voice || msg?.video_note)) {
      await sendPlain(
        env,
        chatId,
        "Поки що не аналізую такі файли в цьому режимі. Хочеш — увімкни збереження у Google Drive кнопкою «Google Drive».",
        { reply_markup: mainKeyboard(ADMIN(env, userId)) }
      );
      return json({ ok: true });
    }
  } catch (e) {
    const isAdm = ADMIN(env, userId);
    if (isAdm) await sendPlain(env, chatId, `❌ Media error: ${String(e).slice(0, 180)}`);
    else await sendPlain(env, chatId, t(lang, "default_reply"));
    return json({ ok: true });
  }

  /* ───── Локальні інтенти: дата/час/погода ───── */
  if (textRaw) {
    const wantsDate = dateIntent(textRaw);
    const wantsTime = timeIntent(textRaw);
    const wantsWeather = weatherIntent(textRaw);

    if (wantsDate || wantsTime || wantsWeather) {
      await safe(async () => {
        if (wantsDate) await sendPlain(env, chatId, replyCurrentDate(env, lang));
        if (wantsTime) await sendPlain(env, chatId, replyCurrentTime(env, lang));

        if (wantsWeather) {
          const byPlace = await weatherSummaryByPlace(env, textRaw, lang);
          const notFound = /Не вдалося знайти такий населений пункт\./.test(byPlace.text);
          if (!notFound) {
            await sendPlain(env, chatId, byPlace.text, { parse_mode: byPlace.mode || undefined });
          } else {
            const geo = await getUserLocation(env, userId);
            if (geo?.lat && geo?.lon) {
              const byCoords = await weatherSummaryByCoords(geo.lat, geo.lon, lang);
              await sendPlain(env, chatId, byCoords.text, { parse_mode: byCoords.mode || undefined });
            } else {
              const askMap = {
                uk: "Будь ласка, надішліть вашу локацію кнопкою нижче — і я покажу погоду для вашого місця.",
                ru: "Пожалуйста, отправьте вашу локацию кнопкой ниже — и я покажу погоду для вашего места.",
                en: "Please share your location using the button below — I’ll show the weather for your area.",
                de: "Bitte teile deinen Standort über die Schaltfläche unten – dann zeige ich dir das Wetter für deinen Ort.",
                fr: "Merci d’envoyer ta position via le bouton ci-dessous — je te montrerai la météo pour ta zone.",
              };
              const ask = askMap[lang.slice(0,2)] || askMap.uk;
              await sendPlain(env, chatId, ask, { reply_markup: askLocationKeyboard() });
            }
          }
        }
      });
      return json({ ok: true });
    }
  }

  /* ───── Звичайний текст → AI ───── */
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

      // Запис реплік користувача ДО авто-тюну
      await pushTurn(env, userId, "user", textRaw);
      await autoUpdateSelfTune(env, userId, lang).catch(() => {});

      const code = await getCodeMode(env, userId);
      const systemHint = await buildSystemHint(env, chatId, userId, lang, { code });
      const name = await getPreferredName(env, msg);
      const expand = /\b(детальн|подроб|подробнее|more|details|expand|mehr|détails)\b/i.test(textRaw);

      // Тимчасово підміняємо порядок моделей за режимом
      const prevOrder = env.MODEL_ORDER;
      env.MODEL_ORDER = pickModelOrder(env, { code });

      const { short, full } = await callSmartLLM(env, textRaw, { lang, name, systemHint, expand, adminDiag: isAdmin });

      // Відновити попередній порядок
      env.MODEL_ORDER = prevOrder;

      await pushTurn(env, userId, "assistant", full);

      // Відправка: TG.sendPlain сам поріже довгі відповіді (в т.ч. код)
      if (expand && full.length > short.length) {
        await sendPlain(env, chatId, full);
      } else {
        await sendPlain(env, chatId, short);
      }

      const after = (cur.energy - need);
      if (after <= Number(cur.low ?? 10)) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "low_energy_notice", after, links.energy));
      }
    });
    return json({ ok: true });
  }

  // Фолбек-привітання
  const profileLang = (msg?.from?.language_code || "").slice(0, 2).toLowerCase();
  const greetLang = ["uk", "ru", "en", "de", "fr"].includes(profileLang) ? profileLang : lang;
  const name = await getPreferredName(env, msg);
  await sendPlain(env, chatId, `${t(greetLang, "hello_name", name)} ${t(greetLang, "how_help")}`, {
    reply_markup: mainKeyboard(isAdmin)
  });
  return json({ ok: true });
}
