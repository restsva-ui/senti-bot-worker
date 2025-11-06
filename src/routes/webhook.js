// src/routes/webhook.js
// (rev) Без вітального відео; тихе перемикання режимів; фікс мови на /start;
// перевірка підключення Google Drive; дружній фолбек для медіа в Senti;
// авто-самотюнінг стилю (мовні профілі) через selfTune.
// (upd) Vision через каскад моделей (мультимовний) + base64 із Telegram файлів.
// (new) Vision Memory у KV: зберігаємо останні 20 фото з описами.
// (fix) Погода через open-meteo: "погода київ" / "weather london".
// (fix) Фото без підпису → зберегти і спитати, що робити.

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
import { t, pickReplyLanguage } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import { enqueueLearn, listQueued, getRecentInsights } from "../lib/kvLearnQueue.js";
import { setUserLocation } from "../lib/geo.js";
import { describeImage } from "../flows/visionDescribe.js";
import { detectLandmarksFromText, formatLandmarkLines } from "../lib/landmarkDetect.js";
// погода — безкоштовна, ключ не потрібен
import * as weatherApi from "../apis/weather.js";

const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_LEARN,
  mainKeyboard, ADMIN, energyLinks, sendPlain, parseAiCommand,
  askLocationKeyboard
} = TG;

const KV = {
  learnMode: (uid) => `learn:mode:${uid}`, // "on" | "off"
};

// ===== vision memory =====
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

// ===== vision text cleaner (прибрати "великі вуха, великі вуха...") =====
function cleanVisionText(text = "", lang = "uk") {
  let s = String(text || "").trim();
  s = s.replace(/\b(\S+)(\s+\1){3,}\b/gi, "$1 $1 $1");
  s = s.replace(/\b([^,]{2,40})(,\s*\1){2,}\b/gi, "$1, $1");
  s = s.replace(/\s{2,}/g, " ").trim();
  const MAX_LEN = 900;
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN) + "…";
  if (!s) {
    s = lang.startsWith("uk")
      ? "На зображенні об’єкт, але модель не змогла описати деталі."
      : "There is an object in the image, but the model could not describe details.";
  }
  return s;
}

// typing
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
// base64 з tg
async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
// media helpers
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

// DRIVE handler
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
      {
        reply_markup: {
          inline_keyboard: [[{ text: t(lang, "open_drive_btn") || "Підключити Drive", url: connectUrl }]]
        }
      }
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

  try {
    const head = await fetch(url, { method: "HEAD" });
    const size = Number(head.headers.get("content-length") || 0);
    if (size && size > 200 * 1024 * 1024) {
      await sendPlain(
        env,
        chatId,
        lang.startsWith("uk")
          ? "⚠️ Файл більший за 200 МБ — не можу зберегти у Drive."
          : "⚠️ File is bigger than 200 MB — can't save to Drive."
      );
      return true;
    }
  } catch {}

  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendPlain(env, chatId, `✅ ${t(lang, "saved_to_drive") || "Збережено на Диск"}: ${saved?.name || att.name}`, {
    reply_markup: {
      inline_keyboard: [[{ text: t(lang, "open_drive_btn") || "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]]
    }
  });

  // якщо це було фото без підпису — одразу питаємо, що робити
  if (pickPhoto(msg) && !msg.caption) {
    await sendPlain(
      env,
      chatId,
      lang.startsWith("uk")
        ? "Фото зберіг ✅ Що з ним зробити? (описати / змінити / надіслати)"
        : "Saved the photo ✅ What should I do with it? (describe / edit / forward)"
    );
  }

  return true;
}

// VISION handler з лендмарками
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const att = pickPhoto(msg);
  if (!att) return false;

  // якщо юзер просто кинув фото без тексту — зберегти в пам’ять і спитати
  if (!caption) {
    const url = await tgFileUrl(env, att.file_id);
    await saveVisionMem(env, userId, { id: att.file_id, url, caption: "", desc: "" });
    await sendPlain(
      env,
      chatId,
      lang.startsWith("uk")
        ? "Я зберіг це фото 📸 Що з ним зробити? (описати / змінити / надіслати)"
        : "I saved this photo 📸 What should I do with it? (describe / edit / forward)"
    );
    return true;
  }

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
  const prompt = caption || (lang.startsWith("uk")
    ? "Опиши, що на зображенні, без повторів і без фантазій."
    : "Describe what is in the image, without repetitions and without fantasy.");

  // 🔴 ГОЛОВНЕ ВИПРАВЛЕННЯ: нормальний каскад 3 моделей
  const visionOrder =
    env.MODEL_ORDER_VISION ||
    env.VISION_ORDER ||
    "gemini:gemini-1.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct, cf:@cf/meta/llama-3.2-1b-vision-instruct";

  try {
    const visionRes = await describeImage(env, {
      imageBase64,
      question: prompt,
      lang,
      userId: userId?.toString?.() || "anon",
      modelOrder: visionOrder,
    });

    if (!visionRes?.ok) {
      throw new Error(visionRes?.message || "vision failed");
    }

    let text = visionRes.text || "";
    text = cleanVisionText(text, lang);

    const landmarks = detectLandmarksFromText(text, lang);

    await saveVisionMem(env, userId, { id: att.file_id, url, caption, desc: text });

    await sendPlain(env, chatId, `🖼️ ${text}`, {
      parse_mode: landmarks.length ? "HTML" : undefined,
      disable_web_page_preview: true
    });

    if (landmarks.length) {
      const landmarkLines = formatLandmarkLines(landmarks, lang).join("\n");
      await sendPlain(env, chatId, landmarkLines, {
        parse_mode: "HTML",
        disable_web_page_preview: true
      });
    }
  } catch (e) {
    if (ADMIN(env, userId)) {
      await sendPlain(env, chatId, `❌ Vision error: ${String(e.message || e).slice(0, 180)}`);
    } else {
      const connectUrl = abs(env, "/auth/drive");
      await sendPlain(
        env,
        chatId,
        lang.startsWith("uk")
          ? "Поки що не можу проаналізувати фото. Можу зберегти його у Google Drive — натисни «Google Drive» або підключи Drive."
          : "I can't analyze the photo right now. I can save it to Google Drive — tap «Google Drive» or connect Drive.",
        { reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn") || "Підключити Drive", url: connectUrl }]] } }
      );
    }
  }
  return true;
}
// SystemHint
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

  let visionBlock = "";
  try {
    const vm = await loadVisionMem(env, userId);
    if (vm?.length) {
      const items = vm.slice(0, 3).map(v => `• ${String(v.desc || v.caption || "").replace(/\s+/g, " ").slice(0, 120)}`);
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

function guessEmoji(text = "") {
  const tt = text.toLowerCase();
  if (tt.includes("машин") || tt.includes("авто") || tt.includes("car")) return "🚗";
  if (tt.includes("вода") || tt.includes("рідина") || tt.includes("water")) return "💧";
  if (tt.includes("світл") || tt.includes("light")) return "☀️";
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

function revealsAiSelf(out = "") {
  const s = out.toLowerCase();
  return (
    /(^|\b)as an? (ai|language model)\b/.test(s) ||
    /\bi am (an|a)? (ai|language model|large language model)\b/.test(s) ||
    /\bdeveloped by (google|openai|meta|anthropic)\b/.test(s) ||
    /я\s+(є|—|-)?\s*(штучн|модель|мова)/i.test(out)
  );
}
function stripProviderSignature(s = "") {
  return String(s).replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "").trim();
}
function limitMsg(s, max = 220) { if (!s) return s; return s.length <= max ? s : s.slice(0, max - 1); }
function chunkText(s, size = 3500) { const out = []; let t = String(s || ""); while (t.length) { out.push(t.slice(0, size)); t = t.slice(size); } return out; }
function looksLikeModelDump(s = "") {
  const x = s.toLowerCase();
  return /here(?:'|)s a breakdown|model/i.test(x);
}
async function safeAsk(env, modelOrder, prompt, { systemHint } = {}) {
  if (modelOrder) {
    try {
      const out = await askAnyModel(env, modelOrder, prompt, { systemHint });
      return out;
    } catch {
      try {
        const out = await think(env, prompt, { systemHint });
        return out;
      } catch {
        return null;
      }
    }
  }
  try {
    const out = await think(env, prompt, { systemHint });
    return out;
  } catch {
    return null;
  }
}

async function callSmartLLM(env, userText, { lang, name, systemHint, expand, adminDiag = false }) {
  const modelOrder = String(env.MODEL_ORDER || "").trim();

  const control = expand
    ? `You are Senti — a thoughtful, emotionally intelligent assistant. Never say you're an AI. Write ONLY in ${lang}.`
    : `You are Senti — human-like assistant. Write ONLY in ${lang}. Keep it short.`;

  const prompt = `User (${name}) says: ${userText}\n${control}`;

  let out = await safeAsk(env, modelOrder, prompt, { systemHint });
  if (!out) {
    const msg = "Виникла помилка при зверненні до AI. Спробуйте пізніше.";
    return { short: msg, full: msg };
  }
  out = stripProviderSignature((out || "").trim());

  if (looksLikeModelDump(out)) {
    const retry = await safeAsk(env, modelOrder, prompt, { systemHint });
    if (retry) out = stripProviderSignature((retry || out).trim());
  }
  if (revealsAiSelf(out)) {
    const fix = `Rewrite the previous answer as Senti. Do NOT mention being an AI. Keep it in ${lang}, concise.`;
    const cleaned = await safeAsk(env, modelOrder, fix, { systemHint });
    if (cleaned) out = stripProviderSignature(cleaned.trim());
  }
  if (!looksLikeEmojiStart(out)) {
    out = `${guessEmoji(userText)} ${out}`;
  }

  const short = expand ? out : limitMsg(out, 220);
  return { short, full: out };
}

// ====== webhook ======
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

  // callback_query
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const userId = cq.from?.id;
    const data = cq.data;
    const lang = pickReplyLanguage(cq.message, "");

    if (data === "DRIVE" || data === BTN_DRIVE) {
      const connectUrl = abs(env, "/auth/drive");
      await sendPlain(env, chatId, t(lang, "drive_connect_hint") || "🔗 Підключи Google Drive:", {
        reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn") || "Відкрити Drive ↗︎", url: connectUrl }]] }
      });
      return json({ ok: true });
    }

    if (data === "SENTI" || data === BTN_SENTI) {
      await setDriveMode(env, userId, false);
      await sendPlain(env, chatId, t(lang, "senti_enabled") || "🤖 Режим Senti увімкнено.");
      return json({ ok: true });
    }

    if (data === "LEARN" || data === BTN_LEARN) {
      await sendPlain(env, chatId, t(lang, "learn_hint") || "🧠 Режим навчання: надішли мені текст/лінк/файл — додам у чергу.");
      return json({ ok: true });
    }

    if (data === "ADMIN" || data === BTN_ADMIN) {
      await sendPlain(env, chatId, t(lang, "admin_header") || "🛠 Адмін-панель поки що мінімальна.");
      return json({ ok: true });
    }

    return json({ ok: true });
  }

  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  let lang = pickReplyLanguage(msg, textRaw);

  const safe = async (fn) => {
    try { await fn(); }
    catch (e) {
      if (isAdmin) await sendPlain(env, chatId, `❌ Error: ${String(e?.message || e).slice(0, 200)}`);
      else try { await sendPlain(env, chatId, t(lang, "default_reply") || "Я тут. Спробуй ще раз 🙌"); } catch {}
    }
  };

  // локація
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, "✅ Локацію збережено. Тепер можна питати погоду.");
    return json({ ok: true });
  }

  // команди
  if (parseAiCommand(env, chatId, userId, textRaw, isAdmin)) {
    return json({ ok: true });
  }

  // /start
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

  // тихі перемикачі
  if (textRaw === BTN_DRIVE || /^(google\s*drive)$/i.test(textRaw)) {
    await setDriveMode(env, userId, true);
    return json({ ok: true });
  }
  if (textRaw === BTN_SENTI || /^(senti|сенті)$/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    return json({ ok: true });
  }

  // /admin
  if (textRaw === "/admin" || textRaw === "/admin@SentiBot" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const mo = String(env.MODEL_ORDER || "").trim();
      const hasGemini = !!(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY || env.GEMINI_KEY);
      const hasCF = !!(env.CLOUDFLARE_API_TOKEN && env.CF_ACCOUNT_ID);
      const hasOR = !!(env.OPENROUTER_API_KEY);
      const hasFreeBase = !!(env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL);
      const hasFreeKey = !!(env.FREE_LLM_API_KEY || env.FREE_API_KEY);
      const lines = [
        t(lang, "admin_header") || "Admin panel (quick diagnostics):",
        `MODEL_ORDER: ${mo || "(not set)"}`,
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
      await sendPlain(env, chatId, lines.join("\n"), {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧠 Open Learn", url: links.learn }],
          ]
        }
      });
    });
    return json({ ok: true });
  }

  // Learn (адмін)
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
        "🧠 Режим Learn.\nНадсилай посилання, файли або архіви — я додам у чергу, **якщо Learn увімкнено** (/learn_on).";
      const keyboard = [[{ text: "🧠 Відкрити Learn HTML", url: links.learn }]];
      await sendPlain(env, chatId, hint, { reply_markup: { inline_keyboard: keyboard } });
    });
    return json({ ok: true });
  }

  // ⛅️ Погода по тексту (без ключа, як просив)
  if (textRaw && (
    /^погода\b/i.test(textRaw) ||
    /^weather\b/i.test(textRaw) ||
    textRaw.toLowerCase().startsWith("погода ")
  )) {
    const place = textRaw.split(/\s+/).slice(1).join(" ").trim();
    let w = null;
    if (place) {
      w = await weatherApi.weatherSummaryByPlace(env, place, lang).catch(() => null);
    }
    if (!w) {
      await sendPlain(
        env,
        chatId,
        lang.startsWith("uk")
          ? "Скажи, для якого міста показати погоду 🌤"
          : "Tell me which city to show the weather for 🌤"
      );
    } else {
      await sendPlain(env, chatId, w.text || (lang.startsWith("uk") ? "Не вдалося отримати погоду." : "Could not get weather."));
    }
    return json({ ok: true });
  }

  // MEDIA routing
  try {
    const driveOn = await getDriveMode(env, userId);
    const hasAnyMedia = !!detectAttachment(msg) || !!pickPhoto(msg);

    if (driveOn && hasAnyMedia) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
    }

    if (!driveOn && pickPhoto(msg)) {
      if (await handleVisionMedia(env, chatId, userId, msg, lang, msg.caption)) return json({ ok: true });
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
    if (isAdmin) await sendPlain(env, chatId, `❌ Media error: ${String(e).slice(0, 180)}`);
    else await sendPlain(env, chatId, t(lang, "default_reply"));
    return json({ ok: true });
  }

  // текст → AI
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

      await pushTurn(env, userId, "user", textRaw);
      await autoUpdateSelfTune(env, userId, lang).catch(() => {});

      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const name = await getPreferredName(env, msg);
      const expand = /\b(детальн|подроб|подробнее|more|details|expand|mehr|détails)\b/i.test(textRaw);
      const { short, full } = await callSmartLLM(env, textRaw, { lang, name, systemHint, expand, adminDiag: isAdmin });

      await pushTurn(env, userId, "assistant", full);

      const after = (cur.energy - need);
      if (expand && full.length > short.length) {
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

  // дефолт
  const profileLang = (msg?.from?.language_code || "").slice(0, 2).toLowerCase();
  const greetLang = ["uk", "ru", "en", "de", "fr"].includes(profileLang) ? profileLang : lang;
  const name = await getPreferredName(env, msg);
  await sendPlain(env, chatId, `${t(greetLang, "hello_name", name) || "Привіт,"} ${t(greetLang, "how_help") || "як я можу допомогти?"}`, {
    reply_markup: mainKeyboard(isAdmin)
  });
  return json({ ok: true });
}
