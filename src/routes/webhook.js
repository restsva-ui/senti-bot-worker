// src/routes/webhook.js — Senti Hybrid 2.5 (stable)

// ───────── Core imports ─────────
import { json } from "../lib/utils.js";
import { TG } from "../lib/tg.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { pushTurn, buildDialogHint } from "../lib/dialogMemory.js";
import { autoUpdateSelfTune } from "../lib/selfTune.js";
import { abs } from "../utils/url.js";

// ───────── Providers ─────────
import { askAnyModel } from "../lib/modelRouter.js";
import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";

// ───────── Geo & Weather ─────────
import { setUserLocation, getUserLocation } from "../lib/geo.js";
import { saveLastPlace, loadLastPlace } from "../apis/userPrefs.js";
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

// ───────── Modes ─────────
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
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

// ───────── Vision ─────────
import { handleVisionMedia } from "../lib/visionHandler.js";

// ───────── TG helpers ─────────
const {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_ADMIN,
  BTN_CODEX,
  mainKeyboard,
  ADMIN,
  sendPlain,
  askLocationKeyboard,
  energyLinks,
} = TG;

/* ================== LOW-LEVEL HELPERS ================== */

function botToken(env) {
  return env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN || "";
}

async function sendTyping(env, chatId) {
  const token = botToken(env);
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

async function sendDocument(env, chatId, filename, content, caption) {
  const token = botToken(env);
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

async function editMessageText(env, chatId, messageId, newText) {
  const token = botToken(env);
  if (!token || !chatId || !messageId) return;
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: newText,
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
    } catch {
      // ігноруємо помилку, анімація — лише косметика
    }
    i++;
  }
}

/* ================== FILE / MEDIA HELPERS ================== */

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
      name: `video_note_${v.file_unique_id}.mp4`,
    };
  }
  return pickPhoto(msg);
}

async function tgFileUrl(env, file_id) {
  const token = botToken(env);
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
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

const hasMedia = (msg) => !!(detectAttachment(msg) || msg?.photo?.length);

/* ================== ADMIN LINKS ================== */

function buildAdminLinks(env, userId) {
  const base = (path) => abs(env, path);
  const secret =
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    "senti1984";

  const checklist = `${base(
    "/admin/checklist/html",
  )}?s=${encodeURIComponent(secret)}&u=${userId}`;
  const energyUrl = `${base(
    "/admin/energy/html",
  )}?s=${encodeURIComponent(secret)}&u=${userId}`;
  const learn = `${base(
    "/admin/learn/html",
  )}?s=${encodeURIComponent(secret)}&u=${userId}`;

  return { checklist, energy: energyUrl, learn };
}

/* ================== CALLBACK QUERY (Codex UI) ================== */

async function handleCallback(env, update) {
  const cq = update.callback_query;
  const chatId = cq?.message?.chat?.id;
  const userId = cq?.from?.id;

  await handleCodexUi(
    env,
    chatId,
    userId,
    { cbData: cq.data },
    { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens },
  );

  const token = botToken(env);
  if (token) {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: cq.id }),
    });
  }

  return true;
}

/* ================== MEDIA LAYER (Drive / Vision) ================== */

async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  let hasTokens = false;
  try {
    hasTokens = !!(await getUserTokens(env, userId));
  } catch {
    hasTokens = false;
  }

  if (!hasTokens) {
    const url = abs(env, "/auth/drive");
    await sendPlain(env, chatId, "Щоб зберігати файли, підключи Google Drive.", {
      reply_markup: {
        inline_keyboard: [[{ text: "Підключити Drive", url }]],
      },
    });
    return true;
  }

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costImage ?? 5);

  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      `⚡ Потрібно ${need} енергії.\n${links.energy}`,
    );
    return true;
  }

  await spendEnergy(env, userId, need, "media");

  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);

  await sendPlain(env, chatId, `📁 Збережено у Drive: ${saved?.name || att.name}`, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Відкрити Drive",
            url: "https://drive.google.com/drive/my-drive",
          },
        ],
      ],
    },
  });

  return true;
}

async function processMediaLayer(env, msg, chatId, userId, lang) {
  const mediaPresent = hasMedia(msg);
  if (!mediaPresent) return false;

  const driveOn = await getDriveMode(env, userId);
  const codexOn = await getCodexMode(env, userId);

  // Drive-режим (збереження у Google Drive)
  if (driveOn && !codexOn) {
    return await handleIncomingMedia(env, chatId, userId, msg, lang);
  }

  // Vision-режим (якщо Drive OFF і Codex OFF)
  if (!driveOn && !codexOn) {
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
        tgFileUrl,
        urlToBase64,
        sendPlain,
        energyLinks,
      },
    );
    if (ok) return true;
  }

  return false;
}

/* ================== CODEX HELPERS ================== */

async function codexConsumeText(env, chatId, userId, textRaw) {
  if (!textRaw) return false;
  return await handleCodexText(
    env,
    { chatId, userId, textRaw },
    { sendPlain, sendInline: sendPlain },
  );
}

async function codexConsumeMedia(env, msg, chatId, userId) {
  const att = detectAttachment(msg);
  if (!att) return false;

  return await handleCodexMedia(
    env,
    {
      chatId,
      userId,
      fileUrl: null,
      fileName: att.name,
    },
    { sendPlain },
  );
}

async function runCodexGeneration(env, chatId, userId, msg, textRaw, lang, isAdmin) {
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
    },
  );
}

/* ================== DATE / TIME / WEATHER ================== */

async function processDateTimeWeather(env, chatId, userId, textRaw, lang) {
  if (!textRaw) return false;

  const wantsDate = dateIntent(textRaw);
  const wantsTime = timeIntent(textRaw);
  const wantsWeather = weatherIntent(textRaw);

  if (!wantsDate && !wantsTime && !wantsWeather) return false;

  if (wantsDate) {
    await sendPlain(env, chatId, replyCurrentDate(env, lang));
  }

  if (wantsTime) {
    await sendPlain(env, chatId, replyCurrentTime(env, lang));
  }

  if (wantsWeather) {
    const byPlace = await weatherSummaryByPlace(env, textRaw, lang);

    if (!/Не вдалося/.test(byPlace.text)) {
      await sendPlain(env, chatId, byPlace.text, {
        parse_mode: byPlace.mode || undefined,
      });
      await saveLastPlace(env, userId, { place: textRaw });
    } else {
      const saved = await loadLastPlace(env, userId);
      if (saved?.lat && saved?.lon) {
        const byCoord = await weatherSummaryByCoords(saved.lat, saved.lon, lang);
        await sendPlain(env, chatId, byCoord.text, {
          parse_mode: byCoord.mode || undefined,
        });
      } else {
        const geo = await getUserLocation(env, userId);
        if (geo?.lat && geo?.lon) {
          const byCoord = await weatherSummaryByCoords(geo.lat, geo.lon, lang);
          await sendPlain(env, chatId, byCoord.text, {
            parse_mode: byCoord.mode || undefined,
          });
        } else {
          await sendPlain(env, chatId, "Надішли локацію — і я покажу погоду.", {
            reply_markup: askLocationKeyboard(),
          });
        }
      }
    }
  }

  return true;
}

/* ================== SENTI MAIN LLM ================== */

async function runSentiLLM(env, chatId, userId, textRaw, lang) {
  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);

  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      `⚡ Потрібно ${need} енергії.\n${links.energy}`,
    );
    return;
  }

  await spendEnergy(env, userId, need, "text");
  await sendTyping(env, chatId);

  await pushTurn(env, userId, "user", textRaw);
  await autoUpdateSelfTune(env, userId, lang).catch(() => {});

  const systemHint = await buildDialogHint(env, userId);

  const order =
    String(env.MODEL_ORDER || "").trim() ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct";

  const res = await askAnyModel(env, order, textRaw, { systemHint });
  const full =
    typeof res === "string"
      ? res
      : res?.choices?.[0]?.message?.content || "Не впевнений.";

  await pushTurn(env, userId, "assistant", full);
  await sendPlain(env, chatId, full);
}

/* ================== MAIN WEBHOOK HANDLER ================== */

export async function handleTelegramWebhook(req, env) {
  if (req.method === "GET") {
    return json({ ok: true, worker: "senti", ts: Date.now() });
  }

  // Validate Telegram secret
  if (req.method === "POST") {
    const expected =
      env.TG_WEBHOOK_SECRET ||
      env.TELEGRAM_SECRET_TOKEN ||
      env.WEBHOOK_SECRET ||
      "";
    if (expected) {
      const sec = req.headers.get("x-telegram-bot-api-secret-token");
      if (sec !== expected) {
        return json({ ok: false, error: "unauthorized" }, 401);
      }
    }
  }

  const update = await req.json();

  // ── callback_query (Codex inline UI) ──
  if (update.callback_query) {
    await handleCallback(env, update);
    return json({ ok: true });
  }

  // ── message ──
  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const isAdmin = ADMIN(env, userId, msg?.from?.username);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const lang = msg?.from?.language_code || "uk";

  const safe = async (fn) => {
    try {
      await fn();
    } catch (e) {
      if (isAdmin) {
        await sendPlain(
          env,
          chatId,
          `❌ Error: ${String(e?.message || e).slice(0, 200)}`,
        );
      } else {
        await sendPlain(env, chatId, "Сталася помилка, спробуй ще раз.");
      }
    }
  };

  // ── save location ──
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, "📍 Локацію збережено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // ── /start ──
  if (textRaw === "/start") {
    await setCodexMode(env, userId, false);
    await setDriveMode(env, userId, false);
    const name = msg?.from?.first_name || "друже";

    await sendPlain(env, chatId, `Привіт, ${name}! Як я можу допомогти?`, {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // ── force Senti mode ──
  if (textRaw === BTN_SENTI || /^\/senti\b/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "🟣 Режим Senti активовано.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // ── Drive mode ──
  if (textRaw === BTN_DRIVE) {
    await setDriveMode(env, userId, true);
    await setCodexMode(env, userId, false);
    await sendPlain(
      env,
      chatId,
      "☁️ Drive-режим: усе, що надішлеш — зберігатиму у Google Drive.",
      { reply_markup: mainKeyboard(isAdmin) },
    );
    return json({ ok: true });
  }

  // ── Admin panel ──
  if (textRaw === "/admin" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const { checklist, energy: energyUrl, learn } = buildAdminLinks(
        env,
        userId,
      );
      const mo = String(env.MODEL_ORDER || "").trim();

      const body = [
        "Admin panel (quick diagnostics):",
        `MODEL_ORDER: ${mo || "(not set)"}`,
        `Gemini key: ${env.GEMINI_API_KEY ? "✅" : "❌"}`,
        `Cloudflare: ${env.CLOUDFLARE_API_TOKEN ? "✅" : "❌"}`,
        `OpenRouter: ${env.OPENROUTER_API_KEY ? "✅" : "❌"}`,
        `FreeLLM: ${env.FREE_LLM_BASE_URL ? "✅" : "❌"}`,
      ].join("\n");

      await sendPlain(env, chatId, body, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Checklist", url: checklist }],
            [{ text: "⚡ Energy", url: energyUrl }],
            [{ text: "🧠 Learn", url: learn }],
          ],
        },
      });
    });
    return json({ ok: true });
  }

  // ── Codex ON ──
  if (textRaw === BTN_CODEX || textRaw === "/codex") {
    if (!isAdmin) {
      await sendPlain(env, chatId, "🛡️ Codex тільки для адміну.");
      return json({ ok: true });
    }

    await clearCodexMem(env, userId);
    await setCodexMode(env, userId, true);

    await sendPlain(
      env,
      chatId,
      "🧠 *Senti Codex увімкнено.* Створи новий проєкт або обери існуючий.",
      { reply_markup: buildCodexKeyboard(false), parse_mode: "Markdown" },
    );
    return json({ ok: true });
  }

  // ── Codex OFF ──
  if (textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await clearCodexMem(env, userId);
    await sendPlain(env, chatId, "🔕 Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // ── MEDIA LAYER BEFORE CODEX ──
  const processedMedia = await processMediaLayer(env, msg, chatId, userId, lang);
  if (processedMedia) return json({ ok: true });

  // ── CODEX MODE ──
  const codexOn = await getCodexMode(env, userId);

  if (codexOn) {
    // 1) текст для службових дій (назва проєкту, idea/tasks/progress)
    const consumedText = await codexConsumeText(env, chatId, userId, textRaw);
    if (consumedText) return json({ ok: true });

    // 2) додаткові команди (/status тощо)
    const handledCmd = await handleCodexCommand(
      env,
      { chatId, userId, msg, textRaw, lang },
      { sendPlain },
    );
    if (handledCmd) return json({ ok: true });

    // 3) медіа всередині проєкту
    if (hasMedia(msg)) {
      const consumedMedia = await codexConsumeMedia(
        env,
        msg,
        chatId,
        userId,
      );
      if (consumedMedia) return json({ ok: true });
    }

    // 4) основна генерація (архітектура, код, документи)
    if (textRaw || hasMedia(msg)) {
      await safe(async () => {
        await runCodexGeneration(
          env,
          chatId,
          userId,
          msg,
          textRaw,
          lang,
          isAdmin,
        );
      });
      return json({ ok: true });
    }
  }

  // ── DATE / TIME / WEATHER ──
  if (await processDateTimeWeather(env, chatId, userId, textRaw, lang)) {
    return json({ ok: true });
  }

  // ── Senti LLM ──
  if (textRaw && !textRaw.startsWith("/")) {
    await safe(async () => {
      await runSentiLLM(env, chatId, userId, textRaw, lang);
    });
    return json({ ok: true });
  }

  // ── DEFAULT ──
  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });

  return json({ ok: true });
}
