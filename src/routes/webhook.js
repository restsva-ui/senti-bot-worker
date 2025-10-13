// Telegram webhook з інтеграцією "мозку" та перевірками доступу/режиму диска.
// Додаємо Статут як системний підказник для AI на кожну текстову взаємодію.
// ⬆️ Self-Tune — інсайти зі STATE_KV (rules/tone).
// ⬆️ Energy — ліміт витрат на текст/медіа з авто-відновленням.
// ⬆️ Dialog Memory — коротка історія у DIALOG_KV з TTL.
// ⬆️ Multilang + Casual — авто-вибір мови (uk/ru/de/en/fr) + розмовний стиль.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";

// ── helpers ───────────────────────────────────────────────────────────────────
const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });

async function sendMessage(env, chatId, text, extra = {}) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true, ...extra }),
  });
  await r.text().catch(() => {});
}

function parseAiCommand(text = "") {
  const s = String(text).trim();
  const m = s.match(/^\/ai(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!m) return null;
  return (m[1] || "").trim();
}

function defaultAiReply() {
  return (
    "🤖 Я можу відповідати на питання, допомагати з кодом, " +
    "зберігати файли на Google Drive (кнопка «Google Drive») " +
    "та керувати чеклистом/репозиторієм. Спробуй запит на тему, яка цікавить!"
  );
}
const isBlank = (s) => !s || !String(s).trim();

const BTN_DRIVE = "Google Drive";
const BTN_SENTI = "Senti";
const BTN_ADMIN = "Admin";
const BTN_CHECK = "Checklist";

const mainKeyboard = (isAdmin = false) => {
  const rows = [[{ text: BTN_DRIVE }, { text: BTN_SENTI }]];
  if (isAdmin) rows.push([{ text: BTN_ADMIN }, { text: BTN_CHECK }]);
  return { keyboard: rows, resize_keyboard: true };
};

const inlineOpenDrive = () => ({
  inline_keyboard: [[{ text: "Відкрити Диск", url: "https://drive.google.com/drive/my-drive" }]],
});

const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);

// ── Multilang (uk/ru/de/en/fr) ────────────────────────────────────────────────
const SUP_LANGS = ["uk", "ru", "de", "en", "fr"];
const LANG_KEY = (uid) => `lang:${uid}`;

const TR = {
  hello: {
    uk: "Привіт! Я Senti 🤖 Готовий допомогти.",
    ru: "Привет! Я Senti 🤖 Готов помочь.",
    de: "Hi! Ich bin Senti 🤖 — bereit zu helfen.",
    en: "Hey! I’m Senti 🤖—ready to help.",
    fr: "Salut ! Je suis Senti 🤖, prêt à aider."
  },
  ai_usage: {
    uk: "✍️ Напиши запит після команди /ai. Напр.:\n/ai Скільки буде 2+2?",
    ru: "✍️ Напиши запрос после команды /ai. Например:\n/ai Сколько будет 2+2?",
    de: "✍️ Schreib deine Frage nach /ai. Z. B.:\n/ai Wieviel ist 2+2?",
    en: "✍️ Type your question after /ai. E.g.:\n/ai What’s 2+2?",
    fr: "✍️ Écris ta question après /ai. Par ex. :\n/ai 2+2 = ?"
  },
  energy_not_enough: {
    uk: (need, links) =>
      `🔋 Не вистачає енергії (потрібно ${need}). Вона відновлюється автоматично.\nКерування:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`,
    ru: (need, links) =>
      `🔋 Недостаточно энергии (нужно ${need}). Она восстанавливается автоматически.\nУправление:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`,
    de: (need, links) =>
      `🔋 Nicht genug Energie (benötigt ${need}). Sie lädt sich automatisch auf.\nVerwalten:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`,
    en: (need, links) =>
      `🔋 Not enough energy (need ${need}). It refills automatically.\nManage:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`,
    fr: (need, links) =>
      `🔋 Pas assez d’énergie (il faut ${need}). Elle se recharge automatiquement.\nGérer :\n• Energy : ${links.energy}\n• Checklist : ${links.checklist}`
  },
  energy_low_hint: {
    uk: (cur, link) => `⚠️ Низький рівень енергії (${cur}). Відновиться автоматично. Керування: ${link}`,
    ru: (cur, link) => `⚠️ Низкий уровень энергии (${cur}). Восстановится автоматически. Управление: ${link}`,
    de: (cur, link) => `⚠️ Niedriger Energiewert (${cur}). Lädt sich automatisch auf. Verwalten: ${link}`,
    en: (cur, link) => `⚠️ Low energy (${cur}). It will refill automatically. Manage: ${link}`,
    fr: (cur, link) => `⚠️ Énergie faible (${cur}). Recharge automatique. Gérer : ${link}`
  },
  drive_auth: {
    uk: (url) => `Щоб зберігати у свій Google Drive — дозволь доступ:\n${url}\n\nПотім натисни «${BTN_DRIVE}» ще раз.`,
    ru: (url) => `Чтобы сохранять в свой Google Drive — дай доступ:\n${url}\n\nПотом нажми «${BTN_DRIVE}» ещё раз.`,
    de: (url) => `Zum Speichern auf deinem Google Drive: bitte Zugriff erlauben:\n${url}\n\nDann drücke nochmal «${BTN_DRIVE}».`,
    en: (url) => `To save to your Google Drive, grant access first:\n${url}\n\nThen tap “${BTN_DRIVE}” again.`,
    fr: (url) => `Pour enregistrer sur ton Google Drive, accorde d’abord l’accès :\n${url}\n\nPuis appuie encore sur « ${BTN_DRIVE} ».`
  },
  drive_on: {
    uk: "📁 Режим диска: ON. Надсилай фото/відео/документи — збережу на твій Google Drive.",
    ru: "📁 Режим диска: ON. Присылай фото/видео/доки — сохраню в твой Google Drive.",
    de: "📁 Drive-Modus: AN. Schick Fotos/Videos/Dokumente — ich speichere sie in deinem Drive.",
    en: "📁 Drive mode: ON. Send photos/videos/docs — I’ll save them to your Drive.",
    fr: "📁 Mode Drive : activé. Envoie photos/vidéos/docs — je les mets sur ton Drive."
  },
  drive_off: {
    uk: "Режим диска вимкнено. Це звичайний чат Senti.",
    ru: "Режим диска выключен. Это обычный чат Senti.",
    de: "Drive-Modus aus. Das ist wieder der normale Senti-Chat.",
    en: "Drive mode is off. Back to normal chat.",
    fr: "Mode Drive désactivé. Retour au chat habituel."
  },
  saved_to_drive: {
    uk: (name) => `✅ Збережено на твоєму диску: ${name}`,
    ru: (name) => `✅ Сохранено на твоём диске: ${name}`,
    de: (name) => `✅ Auf deinem Drive gespeichert: ${name}`,
    en: (name) => `✅ Saved to your Drive: ${name}`,
    fr: (name) => `✅ Enregistré sur ton Drive : ${name}`
  },
  checklist_link: {
    uk: (link) => `📋 Чеклист (HTML):\n${link}`,
    ru: (link) => `📋 Чеклист (HTML):\n${link}`,
    de: (link) => `📋 Checkliste (HTML):\n${link}`,
    en: (link) => `📋 Checklist (HTML):\n${link}`,
    fr: (link) => `📋 Checklist (HTML) :\n${link}`
  },
  admin_menu: {
    uk: (cl, repo, hook) => `🛠 Адмін-меню\n\n• Чеклист: ${cl}\n• Repo: ${repo}\n• Вебхук GET: ${hook}`,
    ru: (cl, repo, hook) => `🛠 Админ-меню\n\n• Чеклист: ${cl}\n• Repo: ${repo}\n• Вебхук GET: ${hook}`,
    de: (cl, repo, hook) => `🛠 Admin-Menü\n\n• Checkliste: ${cl}\n• Repo: ${repo}\n• Webhook GET: ${hook}`,
    en: (cl, repo, hook) => `🛠 Admin menu\n\n• Checklist: ${cl}\n• Repo: ${repo}\n• Webhook GET: ${hook}`,
    fr: (cl, repo, hook) => `🛠 Menu admin\n\n• Checklist : ${cl}\n• Repo : ${repo}\n• Webhook GET : ${hook}`
  },
  generic_error: {
    uk: (e) => `❌ Помилка: ${e}`,
    ru: (e) => `❌ Ошибка: ${e}`,
    de: (e) => `❌ Fehler: ${e}`,
    en: (e) => `❌ Error: ${e}`,
    fr: (e) => `❌ Erreur : ${e}`
  }
};

function normTgLang(code = "") {
  const c = String(code || "").toLowerCase();
  if (c.startsWith("uk")) return "uk";
  if (c.startsWith("ru")) return "ru";
  if (c.startsWith("de")) return "de";
  if (c.startsWith("fr")) return "fr";
  return "en";
}

function detectLangFromText(s = "", fallback = "en") {
  const t = String(s).toLowerCase();

  // quick heuristics by characters
  if (/[їєґі]/i.test(t)) return "uk";
  if (/[ёыэъ]/i.test(t)) return "ru";
  if (/[äöüß]/i.test(t)) return "de";
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(t)) return "fr";

  // stopwords vote
  const votes = { uk: 0, ru: 0, de: 0, en: 0, fr: 0 };
  const bump = (lang, count = 1) => (votes[lang] += count);

  if (/\b(і|та|що|це|так)\b/.test(t)) bump("uk", 2);
  if (/\b(и|что|это|так|ну)\b/.test(t)) bump("ru", 2);
  if (/\b(der|die|und|ist|nicht|ich)\b/.test(t)) bump("de", 2);
  if (/\b(the|and|is|you|i|not)\b/.test(t)) bump("en", 2);
  if (/\b(le|la|et|est|pas|je|tu)\b/.test(t)) bump("fr", 2);

  let best = fallback, max = -1;
  for (const k of SUP_LANGS) { if (votes[k] > max) { max = votes[k]; best = k; } }
  return best;
}

async function getUserLang(env, userId, tgCode, lastText = "") {
  const kv = ensureState(env);
  const key = LANG_KEY(userId);
  const saved = await kv.get(key);
  let lang = saved || normTgLang(tgCode);

  // if user actually writes in another language — switch
  if (lastText && lastText.length >= 3) {
    const detected = detectLangFromText(lastText, lang);
    if (SUP_LANGS.includes(detected) && detected !== lang) {
      lang = detected;
      await kv.put(key, lang, { expirationTtl: 60 * 60 * 24 * 90 }); // 90d
    }
  }
  return SUP_LANGS.includes(lang) ? lang : "en";
}
const tr = (lang, key, ...args) => {
  const v = TR[key]?.[lang] ?? TR[key]?.en;
  return typeof v === "function" ? v(...args) : v;
};

// ── STATE_KV: режим диска ─────────────────────────────────────────────────────
const DRIVE_MODE_KEY = (uid) => `drive_mode:${uid}`;
function ensureState(env) {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
}
async function setDriveMode(env, userId, on) {
  await ensureState(env).put(DRIVE_MODE_KEY(userId), on ? "1" : "0", { expirationTtl: 3600 });
}
async function getDriveMode(env, userId) {
  return (await ensureState(env).get(DRIVE_MODE_KEY(userId))) === "1";
}

// ── Energy subsystem ──────────────────────────────────────────────────────────
const ENERGY_KEY = (uid) => `energy:${uid}`;
function energyCfg(env) {
  return {
    max: Number(env.ENERGY_MAX ?? 100),
    recoverPerMin: Number(env.ENERGY_RECOVER_PER_MIN ?? 1),
    costText: Number(env.ENERGY_COST_TEXT ?? 1),
    costImage: Number(env.ENERGY_COST_IMAGE ?? 5),
    low: Number(env.ENERGY_LOW_THRESHOLD ?? 10),
  };
}
async function getEnergy(env, userId) {
  const cfg = energyCfg(env);
  const raw = await ensureState(env).get(ENERGY_KEY(userId));
  const now = Math.floor(Date.now() / 1000);
  if (!raw) {
    const obj = { v: cfg.max, t: now };
    await ensureState(env).put(ENERGY_KEY(userId), JSON.stringify(obj));
    return obj.v;
  }
  let obj;
  try { obj = JSON.parse(raw); } catch { obj = { v: cfg.max, t: now }; }
  const minutes = Math.floor((now - (obj.t || now)) / 60);
  if (minutes > 0 && obj.v < cfg.max) {
    obj.v = Math.min(cfg.max, obj.v + minutes * cfg.recoverPerMin);
    obj.t = now;
    await ensureState(env).put(ENERGY_KEY(userId), JSON.stringify(obj));
  }
  return obj.v;
}
async function setEnergy(env, userId, v) {
  const now = Math.floor(Date.now() / 1000);
  await ensureState(env).put(ENERGY_KEY(userId), JSON.stringify({ v, t: now }));
  return v;
}
async function spendEnergy(env, userId, cost) {
  const cfg = energyCfg(env);
  const cur = await getEnergy(env, userId);
  if (cur < cost) return { ok: false, cur, need: cost, cfg };
  const left = Math.max(0, cur - cost);
  await setEnergy(env, userId, left);
  return { ok: true, cur: left, cfg };
}
function energyLinks(env, userId) {
  const s = env.WEBHOOK_SECRET || "";
  const qs = `s=${encodeURIComponent(s)}&u=${encodeURIComponent(String(userId || ""))}`;
  return {
    energy: abs(env, `/admin/energy/html?${qs}`),
    checklist: abs(env, `/admin/checklist/html?${qs}`),
  };
}

// ── Dialog Memory (DIALOG_KV) ────────────────────────────────────────────────
const DIALOG_KEY = (uid) => `dlg:${uid}`;
const DLG_CFG = { maxTurns: 12, maxBytes: 8_000, ttlSec: 14 * 24 * 3600 };
function ensureDialog(env) { return env.DIALOG_KV || null; }
async function readDialog(env, userId) {
  const kv = ensureDialog(env); if (!kv) return [];
  try { const raw = await kv.get(DIALOG_KEY(userId)); if (!raw) return []; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
function trimDialog(arr) {
  let out = Array.isArray(arr) ? arr.slice(-DLG_CFG.maxTurns) : [];
  let s = new TextEncoder().encode(JSON.stringify(out)).length;
  while (out.length > 4 && s > DLG_CFG.maxBytes) { out = out.slice(2); s = new TextEncoder().encode(JSON.stringify(out)).length; }
  return out;
}
async function writeDialog(env, userId, arr) {
  const kv = ensureDialog(env); if (!kv) return false;
  const val = JSON.stringify(trimDialog(arr));
  try { await kv.put(DIALOG_KEY(userId), val, { expirationTtl: DLG_CFG.ttlSec }); return true; } catch { return false; }
}
async function pushDialog(env, userId, role, content) {
  const now = Date.now();
  const arr = await readDialog(env, userId);
  arr.push({ r: role, c: String(content || "").slice(0, 1500), t: now });
  return await writeDialog(env, userId, arr);
}
async function buildDialogHint(env, userId) {
  const turns = await readDialog(env, userId);
  if (!turns.length) return "";
  const lines = ["[Context: previous dialog (last messages)]"];
  for (const it of turns.slice(-DLG_CFG.maxTurns)) {
    const who = it.r === "user" ? "User" : "Senti";
    lines.push(`${who}: ${it.c}`);
  }
  return lines.join("\n");
}

// ── Self-Tune ────────────────────────────────────────────────────────────────
async function loadSelfTune(env, chatId) {
  try {
    if (!env.STATE_KV) return null;
    const key = `insight:latest:${chatId}`;
    const raw = await env.STATE_KV.get(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const rules = Array.isArray(obj?.analysis?.rules) ? obj.analysis.rules : [];
    const tone  = obj?.analysis?.tone ? String(obj.analysis.tone).trim() : "";
    if (!rules.length && !tone) return null;

    const lines = [];
    if (tone) lines.push(`• User tone: ${tone}.`);
    if (rules.length) {
      lines.push("• Follow these rules:");
      for (const r of rules.slice(0, 5)) lines.push(`  - ${String(r).trim()}`);
    }
    const text = lines.join("\n");
    return text ? `\n\n[Self-Tune]\n${text}\n` : null;
  } catch {
    return null;
  }
}

// ── System hint (Statut + Self-Tune + Dialog + Language & Casual style) ─────
function langName(l) {
  return { uk: "Ukrainian", ru: "Russian", de: "German", en: "English (US)", fr: "French" }[l] || "English (US)";
}
async function buildSystemHint(env, chatId, userId, lang, extra = "") {
  const statut = await readStatut(env).catch(() => "");
  const selfTune = chatId ? await loadSelfTune(env, chatId) : null;
  const dialogCtx = userId ? await buildDialogHint(env, userId) : "";

  const style =
    `Always reply in ${langName(lang)}.\n` +
    "Use a casual, friendly conversational tone (not formal), short sentences, and be concise.\n" +
    "Use emojis sparingly (only when it feels natural).";

  const base =
    (statut ? `${statut.trim()}\n\n` : "") +
    "You are Senti, a Telegram assistant. If user asks to save a file — remind about Google Drive and Checklist/Repo.";

  const parts = [base, style, selfTune || "", dialogCtx || "", extra || ""].filter(Boolean);
  return parts.join("\n\n");
}

// ── медіа ─────────────────────────────────────────────────────────────────────
function pickPhoto(msg) {
  const a = msg.photo;
  if (!Array.isArray(a) || !a.length) return null;
  const ph = a[a.length - 1];
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
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  const d = await r.json().catch(() => ({}));
  const path = d?.result?.file_path;
  if (!path) throw new Error("getFile: file_path missing");
  return `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${path}`;
}
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  const { costImage } = energyCfg(env);
  const spend = await spendEnergy(env, userId, costImage);
  if (!spend.ok) {
    const links = energyLinks(env, userId);
    await sendMessage(env, chatId, tr(lang, "energy_not_enough", costImage, links));
    return true;
  }

  const ut = await getUserTokens(env, userId);
  if (!ut?.refresh_token) {
    const authUrl = abs(env, `/auth/start?u=${userId}`);
    await sendMessage(env, chatId, tr(lang, "drive_auth", authUrl));
    return true;
  }
  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendMessage(env, chatId, tr(lang, "saved_to_drive", saved?.name || att.name));
  return true;
}

// ── головний обробник вебхуку ────────────────────────────────────────────────
export async function handleTelegramWebhook(req, env) {
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
      return json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  } else {
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  let update;
  try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }

  const msg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.callback_query?.message;

  const textRaw =
    update.message?.text || update.edited_message?.text || update.callback_query?.data || "";
  const text = (textRaw || "").trim();
  if (!msg) return json({ ok: true });

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const isAdmin = ADMIN(env, userId);

  // resolve language (from KV -> TG -> detect by text), update if user speaks another
  const lang = await getUserLang(env, userId, msg.from?.language_code, text);

  const safe = async (fn) => {
    try { await fn(); } catch (e) { await sendMessage(env, chatId, tr(lang, "generic_error", String(e))); }
  };

  // /start
  if (text === "/start") {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      await sendMessage(env, chatId, tr(lang, "hello"), { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // /diag — only admin (left in Ukrainian for you)
  if (text === "/diag" && isAdmin) {
    await safe(async () => {
      const hasGemini   = !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY);
      const hasCF       = !!(env.CF_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN);
      const hasOR       = !!env.OPENROUTER_API_KEY;
      const hasFreeBase = !!env.FREE_API_BASE_URL;
      const hasFreeKey  = !!env.FREE_API_KEY;
      const mo = String(env.MODEL_ORDER || "").trim();

      const lines = [
        "🧪 Діагностика AI",
        `MODEL_ORDER: ${mo || "(порожньо)"}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare (CF_ACCOUNT_ID + CLOUDFLARE_API_TOKEN): ${hasCF ? "✅" : "❌"}`,
        `OpenRouter key: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM (BASE_URL + KEY): ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
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
      await sendMessage(env, chatId, lines.join("\n"));
    });
    return json({ ok: true });
  }

  // /ai
  const aiArg = parseAiCommand(textRaw);
  if (aiArg !== null) {
    await safe(async () => {
      const q = aiArg || "";
      if (!q) {
        await sendMessage(env, chatId, tr(lang, "ai_usage"));
        return;
      }

      const { costText, low } = energyCfg(env);
      const spent = await spendEnergy(env, userId, costText);
      if (!spent.ok) {
        const links = energyLinks(env, userId);
        await sendMessage(env, chatId, tr(lang, "energy_not_enough", costText, links));
        return;
      }

      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let reply = "";
      try {
        if (modelOrder) {
          const merged = `${systemHint}\n\nUser: ${q}`;
          reply = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
        } else {
          reply = await think(env, q, systemHint);
        }
      } catch (e) {
        reply = `🧠 AI error: ${String(e?.message || e)}`;
      }

      if (isBlank(reply)) reply = defaultAiReply();

      await pushDialog(env, userId, "user", q);
      await pushDialog(env, userId, "assistant", reply);

      if (spent.cur <= low) {
        const links = energyLinks(env, userId);
        reply += `\n\n${tr(lang, "energy_low_hint", spent.cur, links.energy)}`;
      }
      await sendMessage(env, chatId, reply);
    });
    return json({ ok: true });
  }

  // Google Drive
  if (text === BTN_DRIVE) {
    await safe(async () => {
      const ut = await getUserTokens(env, userId);
      if (!ut?.refresh_token) {
        const authUrl = abs(env, `/auth/start?u=${userId}`);
        await sendMessage(env, chatId, tr(lang, "drive_auth", authUrl));
        return;
      }
      await setDriveMode(env, userId, true);
      await sendMessage(env, chatId, tr(lang, "drive_on"), { reply_markup: mainKeyboard(isAdmin) });
      await sendMessage(env, chatId, "Open your Drive:", { reply_markup: inlineOpenDrive() });
    });
    return json({ ok: true });
  }

  // Senti (drive off)
  if (text === BTN_SENTI) {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      await sendMessage(env, chatId, tr(lang, "drive_off"), { reply_markup: mainKeyboard(isAdmin) });
    });
    return json({ ok: true });
  }

  // Admin links
  if (text === BTN_CHECK && isAdmin) {
    await safe(async () => {
      const link = abs(env, `/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
      await sendMessage(env, chatId, tr(lang, "checklist_link", link));
    });
    return json({ ok: true });
  }
  if ((text === "Admin" || text === "/admin") && isAdmin) {
    await safe(async () => {
      const cl = abs(env, `/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
      const repo = abs(env, `/admin/repo/html?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
      await sendMessage(env, chatId, tr(lang, "admin_menu", cl, repo, abs(env, "/webhook")));
    });
    return json({ ok: true });
  }

  // Drive mode media
  try {
    if (await getDriveMode(env, userId)) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang)) return json({ ok: true });
    }
  } catch (e) {
    await sendMessage(env, chatId, tr(lang, "generic_error", String(e)));
    return json({ ok: true });
  }

  // Regular text -> AI (with language + casual style)
  if (text && !text.startsWith("/")) {
    try {
      const { costText, low } = energyCfg(env);
      const spent = await spendEnergy(env, userId, costText);
      if (!spent.ok) {
        const links = energyLinks(env, userId);
        await sendMessage(env, chatId, tr(lang, "energy_not_enough", costText, links));
        return json({ ok: true });
      }

      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const modelOrder = String(env.MODEL_ORDER || "").trim();
      let out = "";

      if (modelOrder) {
        const merged = `${systemHint}\n\nUser: ${text}`;
        out = await askAnyModel(env, merged, { temperature: 0.6, max_tokens: 800 });
      } else {
        out = await think(env, text, systemHint);
      }

      if (isBlank(out)) out = defaultAiReply();

      await pushDialog(env, userId, "user", text);
      await pushDialog(env, userId, "assistant", out);

      if (spent.cur <= low) {
        const links = energyLinks(env, userId);
        out += `\n\n${tr(lang, "energy_low_hint", spent.cur, links.energy)}`;
      }
      await sendMessage(env, chatId, out);
      return json({ ok: true });
    } catch (e) {
      await sendMessage(env, chatId, defaultAiReply());
      return json({ ok: true });
    }
  }

  // default
  await sendMessage(env, chatId, tr(lang, "hello"), { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}