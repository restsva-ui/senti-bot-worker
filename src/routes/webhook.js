// src/routes/webhook.js
// (rev) мультимовність з Telegram, Gemini — перший для vision,
// admin має checklist + energy + learn, тихе перемикання режимів,
// learn-тумблери, погода, дата/час, drive/vision роутинг.
// (upd) Codex-режим для задач по коду/ботах/лендінгах.
// (upd) vision → gemini-2.5-flash.
// (upd) /codex_template … → віддаємо готові файли.
// (upd) vision follow-up по останньому фото + клавіатура + розбиття
// (upd) admin по username + розширені фрази для vision-followup

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../utils/http.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune, autoUpdateSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage, detectFromText } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import {
  enqueueLearn,
  listQueued,
  getRecentInsights,
} from "../lib/kvLearnQueue.js";
import {
  dateIntent,
  timeIntent,
  replyCurrentDate,
  replyCurrentTime,
} from "../apis/time.js";
import {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
} from "../apis/weather.js";
import { setUserLocation, getUserLocation } from "../lib/geo.js";
import { describeImage } from "../flows/visionDescribe.js";
import {
  detectLandmarksFromText,
  formatLandmarkLines,
} from "../lib/landmarkDetect.js";
import {
  getCodexTemplate,
  listCodexTemplates,
} from "../lib/codexTemplates.js";

const {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_ADMIN,
  BTN_LEARN,
  BTN_CODEX,
  mainKeyboard,
  ADMIN,
  energyLinks,
  sendPlain,
  askLocationKeyboard,
} = TG;
// KV-ключі
const KV = {
  learnMode: (uid) => `learn:mode:${uid}`,
  codexMode: (uid) => `codex:mode:${uid}`,
};

// додатковий чекер адміна по username,
// щоб не ламати TG.ADMIN, який у тебе вже є
function isAdminUser(env, userId, username) {
  // спершу — стандартний спосіб
  if (ADMIN(env, userId)) return true;

  const uname = String(username || "")
    .replace("@", "")
    .trim()
    .toLowerCase();
  if (!uname) return false;

  const fromEnv = [
    env.ADMIN_USERNAME,
    env.ADMIN_USERNAMES,
    env.ADMINS_USERNAMES,
  ]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((s) => s.replace("@", "").trim().toLowerCase())
    .filter(Boolean);

  if (!fromEnv.length) return false;
  return fromEnv.includes(uname);
}

// vision-пам’ять (останнi 20)
const VISION_MEM_KEY = (uid) => `vision:mem:${uid}`;
async function loadVisionMem(env, userId) {
  try {
    const raw = await (env.STATE_KV || env.CHECKLIST_KV)?.get(
      VISION_MEM_KEY(userId),
      "text"
    );
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
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
      ts: Date.now(),
    });
    await kv.put(VISION_MEM_KEY(userId), JSON.stringify(arr.slice(0, 20)), {
      expirationTtl: 60 * 60 * 24 * 180,
    });
  } catch {}
}

// typing
async function sendTyping(env, chatId) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
    if (!token) return;
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch {}
}
function pulseTyping(env, chatId, times = 4, intervalMs = 4000) {
  sendTyping(env, chatId);
  for (let i = 1; i < times; i++)
    setTimeout(() => sendTyping(env, chatId), i * intervalMs);
}

// base64 з TG
async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// розбивач для великих повідомлень
function splitForTelegram(text, chunk = 3800) {
  if (!text) return [""];
  if (text.length <= chunk) return [text];
  const out = [];
  for (let i = 0; i < text.length; i += chunk) {
    out.push(text.slice(i, i + chunk));
  }
  return out;
}
// media helpers
function pickPhoto(msg) {
  const arr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!arr?.length) return null;
  const ph = arr[arr.length - 1];
  return {
    type: "photo",
    file_id: ph.file_id,
    name: `photo_${ph.file_unique_id}.jpg`,
  };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document) {
    const d = msg.document;
    return {
      type: "document",
      file_id: d.file_id,
      name: d.file_name || `doc_${d.file_unique_id}`,
    };
  }
  if (msg.video) {
    const v = msg.video;
    return {
      type: "video",
      file_id: v.file_id,
      name: v.file_name || `video_${v.file_unique_id}.mp4`,
    };
  }
  if (msg.audio) {
    const a = msg.audio;
    return {
      type: "audio",
      file_id: a.file_id,
      name: a.file_name || `audio_${a.file_unique_id}.mp3`,
    };
  }
  if (msg.voice) {
    const v = msg.voice;
    return {
      type: "voice",
      file_id: v.file_id,
      name: `voice_${v.file_unique_id}.ogg`,
    };
  }
  if (msg.video_note) {
    const v = msg.video_note;
    return {
      type: "video_note",
      file_id: v.file_id,
      name: `videonote_${v.file_unique_id}.mp4`,
    };
  }
  return pickPhoto(msg);
}
async function tgFileUrl(env, file_id) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });
  const data = await r.json().catch(() => null);
  if (!data?.ok) throw new Error("getFile failed");
  const path = data.result?.file_path;
  if (!path) throw new Error("file_path missing");
  return `https://api.telegram.org/file/bot${token}/${path}`;
}

// learn helpers
function extractFirstUrl(text = "") {
  const m = String(text || "").match(/https?:\/\/\S+/i);
  return m ? m[0] : null;
}
async function getLearnMode(env, userId) {
  try {
    return (await env.STATE_KV.get(KV.learnMode(userId))) === "on";
  } catch {
    return false;
  }
}
async function setLearnMode(env, userId, on) {
  try {
    await env.STATE_KV.put(KV.learnMode(userId), on ? "on" : "off");
  } catch {}
}

// 🔎 саме тут розширив фрази для “це про попереднє фото”
function isVisionFollowup(text = "") {
  const s = text.toLowerCase();

  // базові
  if (
    s.includes("де це") ||
    s.includes("що це") ||
    s.includes("що на фото") ||
    s.includes("це київ") ||
    s.includes("де знаходиться") ||
    s.includes("where is this") ||
    s.includes("what is on the photo") ||
    s.includes("яке це місто") ||
    s.includes("цей монумент")
  ) {
    return true;
  }

  // уточнення по будівлях / роках
  if (
    s.includes("якого року") ||
    s.includes("коли побудовано") ||
    s.includes("коли збудовано") ||
    s.includes("якого періоду") ||
    s.includes("which year") ||
    s.includes("when was this built") ||
    s.includes("what year is this building") ||
    s.includes("year of this building")
  ) {
    return true;
  }

  return false;
}
// ... ДАЛІ ВСЕ ЯК У ТВОЄМУ ФАЙЛІ, ТІЛЬКИ isAdmin => isAdminUser ...

// drive-mode
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  // .... (НЕ міняв)
}

// vision-media
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  // .... (НЕ міняв, лишив як у тебе)
}

// Codex helpers
async function getCodexMode(env, userId) { /* ... */ }
async function setCodexMode(env, userId, on) { /* ... */ }
async function runCodex(env, prompt) { /* ... */ }

// SystemHint
async function buildSystemHint(env, chatId, userId, preferredLang) { /* ... */ }

export async function handleTelegramWebhook(req, env) {
  // ... перевірка секрету ...

  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false }, 400);
  }

  const msg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.callback_query?.message;
  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;
  const userId = msg?.from?.id || update?.callback_query?.from?.id;
  const username =
    msg?.from?.username || update?.callback_query?.from?.username || "";
  const isAdmin = isAdminUser(env, userId, username); // ← ось тут головна заміна
  const textRaw = String(msg?.text || msg?.caption || "").trim();

  let lang = pickReplyLanguage(msg, textRaw);

  // ... і далі весь твій код з /start, /admin, Learn, media, vision, follow-up,
  // нічого більше не міняю — він у тебе вже робочий ...

  // (усередині блоку "🟣 vision follow-up: ..." уже використовується
  // наш розширений isVisionFollowup, тому "якого року ці будинки?"
  // піде в describeImage по останньому фото)
}