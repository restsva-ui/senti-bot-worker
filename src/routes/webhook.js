// src/routes/webhook.js
// (rev+++++) One-button Code-mode, нормалізація 'free', дефолтні безкоштовні моделі,
// авто-тюн, Vision/Drive фолбеки, ТИХІ перемикачі режимів, розумний чанкер коду.

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

// ── Alias з tg.js ────────────────────────────────────────────────────────────
const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_LEARN, BTN_CODE,
  mainKeyboard, ADMIN, energyLinks, sendPlain, parseAiCommand,
  askLocationKeyboard, withTyping
} = TG;

// ── Ключі в STATE_KV ────────────────────────────────────────────────────────
const KV = {
  learnMode: (uid) => `learn:mode:${uid}`, // "on" | "off"
  codeMode:  (uid) => `mode:code:${uid}`,  // "on" | "off"
};

// ── Telegram UX helpers (індикатор як у GPT) ────────────────────────────────
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

// ── CF Vision (безкоштовно) ─────────────────────────────────────────────────
async function cfVisionDescribe(env, imageUrl, userPrompt = "", lang = "uk") {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CF_ACCOUNT_ID) throw new Error("CF credentials missing");
  const model = "@cf/llama-3.2-11b-vision-instruct";
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`;

  const messages = [{
    role: "user",
    content: [
      { type: "input_text", text: `${userPrompt || "Describe the image briefly."} Reply in ${lang}.` },
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

// ===== Learn helpers (admin-only, ручний режим) =============================
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

// ── Code-mode KV ────────────────────────────────────────────────────────────
async function getCodeMode(env, userId) {
  try { return (await env.STATE_KV.get(KV.codeMode(userId))) === "on"; } catch { return false; }
}
async function setCodeMode(env, userId, on) {
  try { await env.STATE_KV.put(KV.codeMode(userId), on ? "on" : "off"); } catch {}
}

// ── Нормалізація MODEL_ORDER: заміна голого 'free' → конкретна модель ───────
function normalizeOrder(env, order) {
  const modelId = env.FREE_API_MODEL || "meta-llama/llama-4-scout:free";
  return String(order || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(tok => (tok === "free" ? `free:${modelId}` : tok))
    .join(", ");
}

// ── Вибір порядку моделей (безкоштовні дефолти) ─────────────────────────────
function pickModelOrder(env, { code }) {
  const textOrderEnv = env.MODEL_ORDER_TEXT || env.MODEL_ORDER || "";
  const codeOrderEnv = env.MODEL_ORDER_CODE || "";

  const DEF_TEXT = "cf:@cf/meta/llama-3.1-8b-instruct, free:meta-llama/llama-4-scout:free";
  const DEF_CODE = "openrouter:qwen/qwen3-coder:free, cf:@cf/meta/llama-3.1-8b-instruct, free:meta-llama/llama-4-scout:free";

  const chosen = code ? (codeOrderEnv || DEF_CODE) : (textOrderEnv || DEF_TEXT);
  return normalizeOrder(env, chosen);
}

// ── Анти-розкриття “я AI/LLM” + чистка підписів ─────────────────────────────
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

// ── Відповідь AI + захист ───────────────────────────────────────────────────
function limitMsg(s, max = 220) { if (!s) return s; return s.length <= max ? s : s.slice(0, max - 1); }
function chunkText(s, size = 3500) { const out = []; let t = String(s || ""); while (t.length) { out.push(t.slice(0, size)); t = t.slice(size); } return out; }

/** Розумний чанкер саме для кодових відповідей */
function splitCodeSmart(text, size = 3500) {
  const s = String(text || "");
  if (!s.includes("```") && s.length <= size) return [s];

  // спробуємо зберегти мову з першого блока
  const m = s.match(/```([a-z0-9+-]*)\s/i);
  const lang = m?.[1] || "";

  // якщо є великі код-блоки — ріжемо усередині них, зберігаючи огорожі
  const parts = [];
  let buf = "";
  const lines = s.split("\n");
  for (const line of lines) {
    if ((buf + "\n" + line).length > size) {
      parts.push(buf);
      buf = "";
    }
    buf += (buf ? "\n" : "") + line;
  }
  if (buf) parts.push(buf);

  // обгортаємо шматки, щоб TG не ламав розмітку
  return parts.map((p) => {
    if (p.includes("```")) return p; // уже містить огорожі
    // якщо шматок виглядає як чистий код — огорнемо
    const looksCode = /[{;]\s*$|^\s*(def|class|function|#|\/\/)/m.test(p) || lang;
    return looksCode ? "```" + (lang || "") + "\n" + p + "\n```" : p;
  });
}

function looksLikeModelDump(s = "") {
  const x = s.toLowerCase();
  return /here(?:'|)s a breakdown|model (aliases|mappings|configurations)/i.test(x) || /gemini-?2\.5|openrouter|deepseek|llama/i.test(x);
}

async function callSmartLLM(env, userText, { lang, name, systemHint, expand, adminDiag = false, codeMode = false }) {
  // окремий порядок моделей для коду
  const modelOrder = pickModelOrder(env, { code: codeMode });

  const control = expand
    ? `You are Senti — a thoughtful, emotionally intelligent assistant. Never say you're an AI, model, or a product of any company. Write ONLY in ${lang}; sound natural and human-like. Be warm and helpful. Split long ideas into short Telegram-friendly messages.`
    : (codeMode
        ? `You are Senti, a senior software engineer. Generate COMPLETE, RUNNABLE code with modules and glue code. Prefer one-file examples when feasible. Keep explanations brief. Reply ONLY in ${lang}.`
        : `You are Senti — an independent, human-like assistant. Never mention being AI/GPT or created by anyone. Write ONLY in ${lang}. Keep it short and helpful (1–3 sentences). Answer directly without restating the question.`);

  const prompt = `Add one relevant emoji at the start if natural.
User (${name}) says: ${userText}
${control}`;

  let out;
  try {
    out = await askAnyModel(env, modelOrder, prompt, { systemHint });
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
    let cleaned = await askAnyModel(env, modelOrder, fix, { systemHint });
    cleaned = stripProviderSignature((cleaned || "").trim());
    if (cleaned) out = cleaned;
  }
  if (!/^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(out)) {
    const em = "💡";
    out = `${em} ${out}`;
  }

  const detected = detectFromText(out);
  if (detected && lang && detected !== lang) {
    const hardPrompt = `STRICT LANGUAGE MODE: Respond ONLY in ${lang}. If the previous answer used another language, rewrite it now in ${lang}. Keep it concise.`;
    let fixed = await askAnyModel(env, modelOrder, hardPrompt, { systemHint });
    fixed = stripProviderSignature((fixed || "").trim());
    if (fixed) out = /^[\u2190-\u2BFF\u2600-\u27BF\u{1F000}-\u{1FAFF}]/u.test(fixed) ? fixed : `💡 ${fixed}`;
  }

  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}

// ── маленькі адмін-хелпери для Learn ────────────────────────────────────────
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
}
// ── Сервісні утиліти ────────────────────────────────────────────────────────
function getPreferredName(msg) {
  const f = msg?.from;
  return (f?.first_name || f?.username || "друже").toString();
}

// ── MAIN ────────────────────────────────────────────────────────────────────
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

  // /start — спершу мова з Telegram, потім ім’я
  if (textRaw === "/start") {
    await safe(async () => {
      const profileLang = (msg?.from?.language_code || "").slice(0, 2).toLowerCase();
      const startLang = ["uk", "ru", "en", "de", "fr"].includes(profileLang) ? profileLang : lang;
      const name = getPreferredName(msg);
      await sendPlain(env, chatId, `${t(startLang, "hello_name", name)} ${t(startLang, "how_help")}`, {
        reply_markup: mainKeyboard(isAdmin)
      });
    });
    return json({ ok: true });
  }

  // ТИХІ перемикачі режимів (без повідомлень у чат)
  if (textRaw === BTN_DRIVE || /^(google\s*drive)$/i.test(textRaw)) {
    await setDriveMode(env, userId, true);
    return json({ ok: true });
  }
  if (textRaw === BTN_SENTI || /^(senti|сенті)$/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodeMode(env, userId, false); // вихід із code-mode
    return json({ ok: true });
  }
  if (textRaw === BTN_CODE || /^code$/i.test(textRaw)) {
    await setCodeMode(env, userId, true);
    return json({ ok: true });
  }

  // /admin
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const mo = normalizeOrder(env, env.MODEL_ORDER || "");
      const hasGemini = !!(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY);
      const hasCF = !!(env.CLOUDFLARE_API_TOKEN && env.CF_ACCOUNT_ID);
      const hasOR = !!(env.OPENROUTER_API_KEY);
      const hasFreeBase = !!(env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL);
      const hasFreeKey = !!(env.FREE_LLM_API_KEY || env.FREE_API_KEY);

      const code = await getCodeMode(env, userId);
      const lines = [
        "Admin panel (quick diagnostics):",
        `MODEL_ORDER (runtime): ${mo || "(not set)"}`,
        `MODEL_ORDER_TEXT (env): ${env.MODEL_ORDER_TEXT || "(default CF+free)"}`,
        `MODEL_ORDER_CODE (env): ${env.MODEL_ORDER_CODE || "(default QwenCoder→CF→free)"}`,
        `Code-mode: ${code ? "ON" : "OFF"}`,
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
        [{ text: "🧠 Open Learn", url: links.learn }],
      ]};
      await sendPlain(env, chatId, lines.join("\n"), { reply_markup: markup });
    });
    return json({ ok: true });
  }

  // Кнопка LEARN / команда — лише адмін
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

  // Явні тумблери Learn (адмін)
  if (isAdmin && textRaw === "/learn_on") {
    await setLearnMode(env, userId, true);
    await sendPlain(env, chatId, "✅ Learn увімкнено.", { reply_markup: mainKeyboard(true) });
    return json({ ok: true });
  }
  if (isAdmin && textRaw === "/learn_off") {
    await setLearnMode(env, userId, false);
    await sendPlain(env, chatId, "⏸️ Learn вимкнено.", { reply_markup: mainKeyboard(true) });
    return json({ ok: true });
  }

  // Простий ручний запуск агента learn
  if (isAdmin && textRaw === "/learn_run") {
    await safe(async () => {
      const r = await runLearnNow(env);
      const s = typeof r === "string" ? r : (r?.summary || "ok");
      await sendPlain(env, chatId, `🧠 Learn run: ${s}`);
    });
    return json({ ok: true });
  }

  // Інсайти
  if (isAdmin && /^\/insights/.test(textRaw)) {
    await safe(async () => {
      const items = await listInsights(env, 10);
      const out = items.length ? items.map(i => `• ${i.title}\n  ${i.summary}`).join("\n\n") : "— поки порожньо —";
      await sendPlain(env, chatId, `🧠 Recent insights:\n\n${out}`);
    });
    return json({ ok: true });
  }

  // Авто-обробка медіа (Drive-mode) або Vision
  const attachment = detectAttachment(msg);
  if (attachment) {
    await safe(async () => {
      await withTyping(env, chatId, async () => {
        await handleIncomingMedia(env, chatId, userId, attachment, { lang, isAdmin });
      });
    });
    return json({ ok: true });
  }

  // Спеціальні прості інтенти часу/дати/погоди
  if (dateIntent(textRaw))     return await replyCurrentDate(env, chatId, lang);
  if (timeIntent(textRaw))     return await replyCurrentTime(env, chatId, lang);
  if (weatherIntent(textRaw))  return await handleWeather(env, chatId, userId, textRaw, lang);

  // Власне діалог/код
  if (textRaw) {
    await safe(async () => {
      const codeMode = await getCodeMode(env, userId);
      const dialogHint = await buildDialogHint(env, userId);

      const systemHint = await loadSelfTune(env);
      const name = getPreferredName(msg);

      const { full } = await callSmartLLM(env, textRaw, {
        lang, name, systemHint: dialogHint + "\n" + systemHint, expand: codeMode, codeMode
      });

      // для повноцінного коду розрізаємо без втрати форматування
      const chunks = codeMode ? splitCodeSmart(full) : chunkText(full, 3500);
      for (const part of chunks) {
        await sendPlain(env, chatId, part);
      }

      await pushTurn(env, userId, { q: textRaw, a: full, codeMode });
      await autoUpdateSelfTune(env, { userText: textRaw, answer: full });
    });
    return json({ ok: true });
  }

  return json({ ok: true });
}

// ── Обробка погоди ──────────────────────────────────────────────────────────
async function handleWeather(env, chatId, userId, text, lang) {
  const place = text.replace(/\s+/g, " ").trim();
  const loc = await getUserLocation(env, userId);
  if (/запор/i.test(place) && !loc) {
    await sendPlain(env, chatId, "☔ Будь ласка, надішліть вашу локацію кнопкою нижче — і я покажу погоду для вашого місця.", {
      reply_markup: askLocationKeyboard()
    });
    return json({ ok: true });
  }
  if (loc?.latitude && loc?.longitude) {
    const rep = await weatherSummaryByCoords(env, loc.latitude, loc.longitude, lang);
    await sendPlain(env, chatId, rep, { reply_markup: mainKeyboard(ADMIN(env, userId)) });
    return json({ ok: true });
  }
  const city = place.replace(/^(погода|яка|какая|what).*?\b/iu, "").trim();
  const rep = await weatherSummaryByPlace(env, city || "Kyiv", lang);
  await sendPlain(env, chatId, rep, { reply_markup: mainKeyboard(ADMIN(env, userId)) });
  return json({ ok: true });
}

// ── Обробка медіа (Drive/Віжн) ──────────────────────────────────────────────
async function handleIncomingMedia(env, chatId, userId, att, { lang, isAdmin }) {
  const inDrive = await getDriveMode(env, userId);
  const fileUrl = await tgFileUrl(env, att.file_id);

  if (inDrive) {
    // якщо є OAuth до Drive — збережемо файл у корінь або папку з env
    try {
      const tokens = await getUserTokens(env, userId);
      if (!tokens) throw new Error("Drive not linked");
      const folderId = env.DRIVE_FOLDER_ID || "root";
      const saved = await driveSaveFromUrl(env, tokens, { url: fileUrl, filename: att.name, folderId });
      const open = abs(env, `/drive/open/${encodeURIComponent(saved?.id || "")}`);
      await sendPlain(env, chatId, `✅ Збережено на Диск:\n${att.name}`, {
        reply_markup: { inline_keyboard: [[{ text: "Відкрити Диск", url: open }]] }
      });
    } catch (e) {
      await sendPlain(env, chatId, `❌ Media error: ${e?.message || e}`);
    }
    return;
  }

  // Vision-режим (опис зображення)
  if (att.type === "photo") {
    try {
      const brief = await cfVisionDescribe(env, fileUrl, "Коротко опиши фото.", lang);
      await sendPlain(env, chatId, brief);
    } catch (e) {
      await sendPlain(env, chatId, `❌ Vision error: ${e?.message || e}`);
    }
    return;
  }

  // якщо це не фото і не Drive — просто підтвердимо отримання
  await sendPlain(env, chatId, "📥 Файл отримано.");
}
