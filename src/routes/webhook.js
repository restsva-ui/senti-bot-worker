// src/routes/webhook.js
// Переписано. Повна стабільність Codex + Senti.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js"; 
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune, autoUpdateSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import { getRecentInsights } from "../lib/kvLearnQueue.js";

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

import { saveLastPlace, loadLastPlace } from "../apis/userPrefs.js";
import { setUserLocation, getUserLocation } from "../lib/geo.js";

import {
  setCodexMode,
  getCodexMode,
  clearCodexMem,
  handleCodexCommand,
  handleCodexGeneration,
  handleCodexText,
  handleCodexMedia,
  buildCodexKeyboard,
  handleCodexUi,
} from "../lib/codexHandler.js";

const {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_ADMIN,
  BTN_CODEX,
  mainKeyboard,
  ADMIN,
  energyLinks,
  sendPlain,
  askLocationKeyboard,
} = TG;

/* ================== HELPERS ================== */

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

function pulseTyping(env, chatId, times = 4, intervalMs = 3500) {
  sendTyping(env, chatId);
  for (let i = 1; i < times; i++) {
    setTimeout(() => sendTyping(env, chatId), i * intervalMs);
  }
}

async function sendDocument(env, chatId, filename, content, caption) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) return;
  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  const file = new File([content], filename, { type: "text/plain" });
  fd.append("document", file);
  if (caption) fd.append("caption", caption);
  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: fd,
  });
}
/* ================== FILE UTILS ================== */

async function editMessageText(env, chatId, messageId, newText) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token || !chatId || !messageId) return;
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: newText,
      parse_mode: "Markdown",
    }),
  });
}

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function startPuzzleAnimation(env, chatId, messageId, signal) {
  const frames = [
    "💬 Думаю над ідеями…",
    "🔍 Аналізую матеріали…",
    "🧠 Формую пропозиції…",
    "⚙️ Оновлюю проєкт…",
  ];
  let i = 0;
  while (!signal.done) {
    await sleep(1500);
    if (signal.done) break;
    try {
      await editMessageText(env, chatId, messageId, frames[i % frames.length]);
    } catch {}
    i++;
  }
}

/* ================== TG FILE URL ================== */

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

async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/* ================== PHOTO / MEDIA DETECTION ================== */

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
  if (msg.video) {
    const v = msg.video;
    return { type: "video", file_id: v.file_id, name: v.file_name };
  }
  if (msg.audio) {
    const a = msg.audio;
    return { type: "audio", file_id: a.file_id, name: a.file_name };
  }
  if (msg.voice) {
    const v = msg.voice;
    return { type: "voice", file_id: v.file_id, name: `voice_${v.file_unique_id}.ogg` };
  }
  if (msg.video_note) {
    const v = msg.video_note;
    return { type: "video_note", file_id: v.file_id, name: `video_note_${v.file_unique_id}.mp4` };
  }
  return pickPhoto(msg);
}

/* ================== CALLBACK QUERY (Codex UI) ================== */

export async function handleTelegramWebhook(req, env) {
  if (req.method === "GET") {
    return json({ ok: true, worker: "senti", ts: Date.now() });
  }

  if (req.method === "POST") {
    const expected =
      env.TG_WEBHOOK_SECRET ||
      env.TELEGRAM_SECRET_TOKEN ||
      env.WEBHOOK_SECRET || "";

    if (expected) {
      const sec = req.headers.get("x-telegram-bot-api-secret-token");
      if (sec !== expected)
        return json({ ok: false, error: "unauthorized" }, 401);
    }
  }

  const update = await req.json();

  // INLINE CODEx UI
  if (update.callback_query) {
    const cq = update.callback_query;
    const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
    const chatId = cq?.message?.chat?.id;
    const userId = cq?.from?.id;

    const handled = await handleCodexUi(
      env,
      chatId,
      userId,
      { cbData: cq.data },
      { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens }
    );

    if (token) {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: cq.id }),
      });
    }

    if (handled) return json({ ok: true });
    return json({ ok: true });
  }
/* ================== MESSAGE / MAIN FLOW ================== */

  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const isAdmin = ADMIN(env, userId, msg?.from?.username);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const userLang = msg?.from?.language_code || "uk";
  let lang = pickReplyLanguage(msg, textRaw);

  const safe = async (fn) => {
    try {
      await fn();
    } catch (e) {
      if (isAdmin) {
        await sendPlain(env, chatId, `❌ Error: ${String(e.message || e).slice(0,200)}`);
      } else {
        await sendPlain(env, chatId, "Сталася помилка, спробуй ще раз.");
      }
    }
  };

  /* ================== SAVE LOCATION ================== */

  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, "✅ Локацію збережено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  /* ================== START ================== */

  if (textRaw === "/start") {
    await safe(async () => {
      await setCodexMode(env, userId, false);
      const name = msg?.from?.first_name || "друже";
      if ((userLang || "").startsWith("uk")) {
        await sendPlain(env, chatId, `Привіт, ${name}! Як я можу допомогти?`, {
          reply_markup: mainKeyboard(isAdmin),
        });
      } else {
        await sendPlain(env, chatId, `Hi, ${name}! How can I help?`, {
          reply_markup: mainKeyboard(isAdmin),
        });
      }
    });
    return json({ ok: true });
  }

  /* ================== FORCE SENTI ================== */

  if (textRaw === BTN_SENTI || /^\/senti\b/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "🟣 Режим Senti активовано.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  /* ================== DRIVE ON ================== */

  if (textRaw === BTN_DRIVE) {
    await setDriveMode(env, userId, true);
    await setCodexMode(env, userId, false);
    await sendPlain(
      env,
      chatId,
      "☁️ Drive-режим: усе, що надішлеш — зберігатиму у Google Drive.",
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }

  /* ================== ADMIN PANEL ================== */

  if (textRaw === "/admin" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const { checklist, energy, learn } = buildAdminLinks(env, userId);
      const mo = String(env.MODEL_ORDER || "").trim();

      const body = [
        "Admin panel:",
        `MODEL_ORDER: ${mo || "(not set)"}`,
        `Gemini API: ${env.GEMINI_API_KEY ? "✅" : "❌"}`,
        `Cloudflare: ${env.CLOUDFLARE_API_TOKEN ? "✅" : "❌"}`,
        `OpenRouter: ${env.OPENROUTER_API_KEY ? "✅" : "❌"}`,
      ].join("\n");

      await sendPlain(env, chatId, body, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Checklist", url: checklist }],
            [{ text: "⚡ Energy", url: energy }],
            [{ text: "🧠 Learn", url: learn }],
          ],
        },
      });
    });
    return json({ ok: true });
  }

  /* ================== CODEX ON ================== */

  if (textRaw === BTN_CODEX || textRaw === "/codex") {
    if (!isAdmin) {
      await sendPlain(env, chatId, "🛡️ Codex тільки для адміну.");
      return json({ ok: true });
    }

    await setCodexMode(env, userId, true);
    await clearCodexMem(env, userId);

    await sendPlain(
      env,
      chatId,
      "🧠 *Senti Codex увімкнено.*\n\n" +
        "Створи новий проєкт або обери існуючий.",
      { reply_markup: buildCodexKeyboard(false) }
    );
    return json({ ok: true });
  }

  /* ================== CODEX OFF ================== */

  if (textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await clearCodexMem(env, userId);
    await sendPlain(env, chatId, "🔕 Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  /* ======================================================
       MEDIA (FIRST LAYER)
       — якщо Codex викл → Drive або Vision
     ====================================================== */

  const hasMedia = !!detectAttachment(msg) || !!pickPhoto(msg);
  const driveOn = await getDriveMode(env, userId);
  const codexOn = await getCodexMode(env, userId);

  if (hasMedia && !codexOn) {
    // DRIVE MODE
    if (driveOn) {
      const ok = await handleIncomingMedia(env, chatId, userId, msg, lang);
      if (ok) return json({ ok: true });
    }

    // VISION MODE
    const ok = await handleVisionMedia(
      env,
      {
        chatId,
        userId,
        msg,
        lang,
        caption: msg?.caption,
      },
      {
        getEnergy,
        spendEnergy,
        energyLinks,
        sendPlain,
        tgFileUrl,
        urlToBase64,
      }
    );

    if (ok) return json({ ok: true });
  }

  /* ======================================================
        CODEX MODE: TEXT INPUT HANDLER (CRITICAL FIX)
     ====================================================== */

  if (codexOn) {
    const consumedText = await handleCodexText(
      env,
      { chatId, userId, textRaw },
      { sendPlain, sendInline: sendPlain }
    );
    if (consumedText) return json({ ok: true });
  }

  /* ======================================================
        CODEX MODE: ADDITIONAL COMMANDS
     ====================================================== */

  if (codexOn) {
    const handledCmd = await handleCodexCommand(
      env,
      { chatId, userId, msg, textRaw, lang },
      { sendPlain }
    );
    if (handledCmd) return json({ ok: true });
  }

  /* ======================================================
        CODEX MODE: MEDIA (inside project)
     ====================================================== */

  if (codexOn && hasMedia) {
    const consumedMedia = await handleCodexMedia(
      env,
      {
        chatId,
        userId,
        fileUrl: null,
        fileName: detectAttachment(msg)?.name || pickPhoto(msg)?.name,
      },
      { sendPlain }
    );
    if (consumedMedia) return json({ ok: true });
  }
/* ======================================================
        CODEX MODE: MAIN GENERATION (text + images)
     ====================================================== */

  if (codexOn && (textRaw || hasMedia)) {
    await safe(async () => {
      await handleCodexGeneration(
        env,
        {
          chatId,
          userId,
          msg,
          textRaw,
          lang,
          isAdmin,
        },
        {
          getEnergy,
          spendEnergy,
          energyLinks,
          sendPlain,
          pickPhoto,
          tgFileUrl,
          urlToBase64,
          describeImage: null,
          sendDocument,
          startPuzzleAnimation,
          editMessageText,
          driveSaveFromUrl,
          getUserTokens,
        }
      );
    });
    return json({ ok: true });
  }

  /* ======================================================
        SENTI MODE (only if Codex OFF)
     ====================================================== */

  if (!codexOn && textRaw && !textRaw.startsWith("/")) {
    await safe(async () => {
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

      const order =
        String(env.MODEL_ORDER || "").trim() ||
        "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";

      const res = await askAnyModel(env, order, textRaw, { systemHint });
      const full = (typeof res === "string"
        ? res
        : res?.choices?.[0]?.message?.content) || "Не впевнений.";

      await pushTurn(env, userId, "assistant", full);
      await sendPlain(env, chatId, full);
    });
    return json({ ok: true });
  }

  /* ======================================================
        DEFAULT FALLBACK
     ====================================================== */

  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });

  return json({ ok: true });
}
