// src/routes/webhook.js
// (rev) мультимовність з Telegram, Gemini — перший для vision,
// admin має checklist + energy + learn, тихе перемикання режимів,
// learn-тумблери, погода, дата/час, drive/vision роутинг.
// (upd) Codex-режим для задач по коду/ботах/лендінгах.
// (upd) vision → gemini-2.5-flash.
// (upd) /codex_template … → віддаємо готові файли.

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
// typing animation
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

// base64 з Telegram
async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// розбивач великих повідомлень
function splitForTelegram(text, chunk = 3800) {
  if (!text) return [""];
  if (text.length <= chunk) return [text];
  const out = [];
  for (let i = 0; i < text.length; i += chunk)
    out.push(text.slice(i, i + chunk));
  return out;
}

// визначення вкладень
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
    return { type: "document", file_id: d.file_id, name: d.file_name };
  }
  if (msg.video)
    return { type: "video", file_id: msg.video.file_id, name: "video.mp4" };
  if (msg.voice)
    return { type: "voice", file_id: msg.voice.file_id, name: "voice.ogg" };
  if (msg.audio)
    return { type: "audio", file_id: msg.audio.file_id, name: "audio.mp3" };
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
  return `https://api.telegram.org/file/bot${token}/${path}`;
}
// Codex-режим
async function getCodexMode(env, userId) {
  try {
    return (await (env.STATE_KV || env.CHECKLIST_KV).get(
      `codex:mode:${userId}`
    )) === "on";
  } catch {
    return false;
  }
}
async function setCodexMode(env, userId, on) {
  try {
    await (env.STATE_KV || env.CHECKLIST_KV).put(
      `codex:mode:${userId}`,
      on ? "on" : "off"
    );
  } catch {}
}

async function runCodex(env, prompt) {
  const system =
    "Ти — Senti Codex. Віддаєш ПОВНІ файли без ..., без пояснень. Якщо HTML/JS — дай чистий код без ```.";
  const order =
    env.CODEX_MODEL_ORDER ||
    env.MODEL_ORDER ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct";
  return await askAnyModel(env, order, prompt, { systemHint: system });
}

// Головний webhook
export async function handleTelegramWebhook(req, env) {
  if (req.method !== "POST")
    return json({ ok: true, note: "webhook alive (GET)" });

  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false }, 400);
  }

  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const username = msg?.from?.username;
  const isAdmin = ADMIN(env, userId, username);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const lang = pickReplyLanguage(msg, textRaw);

  const codexOn = await getCodexMode(env, userId);

  // Codex режим доступний лише адміну
  if (textRaw === BTN_CODEX) {
    if (!isAdmin) {
      await sendPlain(env, chatId, "⚠️ Codex доступний лише адміну.");
      return json({ ok: true });
    }
    await setCodexMode(env, userId, true);
    await sendPlain(env, chatId, "🧠 Codex-режим увімкнено.");
    return json({ ok: true });
  }

  // Вимкнення Codex
  if (textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "🧠 Codex-режим вимкнено.");
    return json({ ok: true });
  }

  // Якщо Codex увімкнено
  if (codexOn && textRaw) {
    await sendPlain(env, chatId, "🧩 Працюю над кодом...");
    const result = await runCodex(env, textRaw);
    let ans = result;
    if (typeof ans === "string") {
      ans = ans.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
    }
    const parts = splitForTelegram(ans);
    for (const p of parts) await sendPlain(env, chatId, p);
    return json({ ok: true });
  }
// Звичайні тексти (AI відповіді)
  if (textRaw) {
    const reply = await think(env, { prompt: textRaw, userId, chatId });
    const parts = splitForTelegram(reply);
    for (const p of parts)
      await sendPlain(env, chatId, p, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  await sendPlain(env, chatId, "👋 Привіт! Я Senti.", {
    reply_markup: mainKeyboard(isAdmin),
  });
  return json({ ok: true });
}