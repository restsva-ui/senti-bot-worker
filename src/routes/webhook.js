// src/routes/webhook.js
// (rev) Без вітального відео; тихе перемикання режимів; фікс мови на /start;
// перевірка підключення Google Drive; дружній фолбек для медіа в Senti;
// авто-самотюнінг стилю (мовні профілі) через selfTune.
// (upd) Vision через каскад моделей (мультимовний) + base64 із Telegram файлів.
// (new) Vision Memory у KV: зберігаємо останні 20 фото з описами.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { buildSystemHint } from "../lib/systemHint.js";
import { getPreferredName } from "../lib/profile.js";
import { pickReplyLanguage, t } from "../lib/i18n.js";
import { chunkText, limitMsg } from "../utils/text.js";
import { sendPlain, tgFileUrl, sendTyping } from "../lib/telegram.js";
import { getDriveMode } from "../lib/driveMode.js";
import { describeImage } from "../flows/visionDescribe.js";
import weatherApi from "../apis/weather.js";
import { detectLandmarksFromText, formatLandmarkLines } from "../lib/landmarkDetect.js";

const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_LEARN,
  mainKeyboard, adminKeyboard,
} = await import("../lib/tg.js");

const ADMIN = (env, userId) => {
  const ids = String(env.ADMIN_IDS || "").split(/[,\s]+/).filter(Boolean);
  return ids.includes(String(userId));
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
// простий “typing”
async function sendTypingSafe(env, chatId) {
  try {
    await sendTyping(env, chatId);
  } catch {}
}
function pulseTyping(env, chatId, times = 4, intervalMs = 4000) {
  sendTypingSafe(env, chatId);
  for (let i = 1; i < times; i++) setTimeout(() => sendTypingSafe(env, chatId), i * intervalMs);
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
  if (msg.document) return { type: "document", file_id: msg.document.file_id, name: msg.document.file_name };
  if (msg.video) return { type: "video", file_id: msg.video.file_id, name: msg.video.file_name || "video.mp4" };
  if (msg.audio) return { type: "audio", file_id: msg.audio.file_id, name: msg.audio.file_name || "audio.mp3" };
  if (msg.voice) return { type: "voice", file_id: msg.voice.file_id, name: "voice.ogg" };
  if (msg.video_note) return { type: "video_note", file_id: msg.video_note.file_id, name: "video_note.mp4" };
  return null;
}

// clean vision text від повторів
function cleanVisionText(text = "", lang = "uk") {
  let t = String(text || "").trim();
  t = t.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  // прибрати “немає тексту” як окремий рядок
  t = t.replace(/Текст на зображенні:\s*("?"?(немає|нема|no text|none)"?"?)?/gi, "").trim();
  // укорочення
  const parts = t.split("\n").filter(Boolean);
  if (parts.length > 4) t = parts.slice(0, 4).join("\n");
  return t;
}

// для енергії (як у тебе було)
function energyLinks(env, userId) {
  const base = abs(env, `/admin/energy?uid=${encodeURIComponent(userId)}`);
  return { energy: base };
}
// VISION handler
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const att = pickPhoto(msg);
  if (!att) return false;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(
      lang, "need_energy_text", need, links.energy));
    return true;
  }
  await spendEnergy(env, userId, need, "vision");

  pulseTyping(env, chatId);

  const url = await tgFileUrl(env, att.file_id);
  const imageBase64 = await urlToBase64(url);
  const prompt = caption || (lang.startsWith("uk")
    ? "Опиши, що на зображенні, без повторів і без фантазій."
    : "Describe what is in the image, without repetitions and without fantasy.");

  try {
    const visionRes = await describeImage(env, {
      imageBase64,
      question: prompt,
      lang,
      userId: userId?.toString?.() || "anon",
      // пріоритетно ENV для vision
      modelOrder: (env.MODEL_ORDER_VISION || env.VISION_ORDER || env.MODEL_ORDER || "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct"),
    });

    if (!visionRes?.text) throw new Error("vision failed");
    let text = cleanVisionText(visionRes.text, lang);
    const landmarks = detectLandmarksFromText(text, lang);

    await saveVisionMem(env, userId, { id: att.file_id, url, caption, desc: text });

    await sendPlain(env, chatId, `🖼️ ${text}`, {
      parse_mode: landmarks.length ? "HTML" : undefined,
      reply_markup: landmarks.length ? {
        inline_keyboard: [formatLandmarkLines(landmarks)]
      } : undefined
    });
  } catch (err) {
    await sendPlain(env, chatId, lang.startsWith("uk")
      ? "❌ Не вдалося проаналізувати фото."
      : "❌ Failed to analyze the image.");
  }
  return true;
}
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

  // callback_query тут як у тебе було …
  if (update.callback_query) {
    // ... залишаємо твій обробник кнопок admin/learn
  }

  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  let lang = pickReplyLanguage(msg, textRaw);

  // локація → зберегли
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, "✅ Локацію збережено. Тепер можна питати погоду.");
    return json({ ok: true });
  }

  // ⛅️ ДОБАВЛЕНО: погода по тексту
  if (textRaw && (/^погода\b/i.test(textRaw) || /^weather\b/i.test(textRaw) ||
    textRaw.toLowerCase().startsWith("погода ") || textRaw.toLowerCase().startsWith("weather "))) {
    const place = textRaw.split(/\s+/).slice(1).join(" ").trim();
    const w = place
      ? await weatherApi.weatherSummaryByPlace(place, lang)
      : { text: "Скажи, для якого міста показати погоду 👇" };
    await sendPlain(env, chatId, w.text || "Не вдалося отримати погоду.");
    return json({ ok: true });
  }

  // MEDIA routing
  try {
    const driveOn = await getDriveMode(env, userId);
    const hasAnyMedia = !!detectAttachment(msg) || !!pickPhoto(msg);

    if (driveOn && hasAnyMedia) {
      const handled = await handleIncomingMedia(env, chatId, userId, msg, lang);
      // 👇 ДОБАВЛЕНО: якщо це було фото без підпису — спитай, що зробити
      if (handled && pickPhoto(msg) && !msg.caption) {
        await sendPlain(
          env,
          chatId,
          lang.startsWith("uk")
            ? "Фото зберіг ✅ Що з ним зробити? (описати / змінити / надіслати)"
            : "Saved the photo ✅ What should I do with it? (describe / edit / forward)"
        );
      }
      if (handled) return json({ ok: true });
    }

    if (!driveOn && pickPhoto(msg)) {
      if (await handleVisionMedia(env, chatId, userId, msg, lang, msg.caption)) return json({ ok: true });
    }

    // … далі лишаєш твій існуючий обробник тексту /admin /learn /start
  } catch (err) {
    if (isAdmin) await sendPlain(env, chatId, `❌ ${String(err?.message || err)}`);
  }

  // дефолт як у тебе було…
  await sendPlain(env, chatId, "👋 Я тут. Що робимо далі?", {
    reply_markup: mainKeyboard(isAdmin)
  });
  return json({ ok: true });
}
