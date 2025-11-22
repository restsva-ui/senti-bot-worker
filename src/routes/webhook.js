// src/routes/webhook.js — Senti Hybrid 2.5 (Compact Edition)

// Core imports
import { json } from "../lib/utils.js";
import { TG } from "../lib/tg.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { pushTurn, buildDialogHint } from "../lib/dialogMemory.js";
import { autoUpdateSelfTune } from "../lib/selfTune.js";
import { abs } from "../utils/url.js";

// Providers
import { askAnyModel } from "../lib/modelRouter.js";
import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";

// Geo & Weather
import { setUserLocation, getUserLocation } from "../lib/geo.js";
import { saveLastPlace, loadLastPlace } from "../apis/userPrefs.js";
import {
  dateIntent, timeIntent,
  replyCurrentDate, replyCurrentTime
} from "../apis/time.js";
import {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords
} from "../apis/weather.js";

// Modes
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import {
  setCodexMode, getCodexMode, clearCodexMem,
  handleCodexCommand, handleCodexGeneration,
  handleCodexText, handleCodexMedia, buildCodexKeyboard,
  handleCodexUi
} from "../lib/codexHandler.js";

// Vision
import { handleVisionMedia } from "../lib/visionHandler.js";

// Telegram helpers
const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_CODEX,
  mainKeyboard, ADMIN, sendPlain, askLocationKeyboard
} = TG;

/* ============== TELEGRAM UTILS ============== */

async function sendTyping(env, chatId) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" })
  });
}

function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document) return { type: "document", file_id: msg.document.file_id, name: msg.document.file_name };
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1];
    return { type: "photo", file_id: p.file_id, name: `photo_${p.file_unique_id}.jpg` };
  }
  return null;
}

async function tgFileUrl(env, file_id) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id })
  });
  const d = await r.json();
  return `https://api.telegram.org/file/bot${token}/${d.result.file_path}`;
}

/* ============== CALLBACK QUERY (Codex UI) ============== */

async function handleCallback(env, update) {
  const cq = update.callback_query;
  const chatId = cq?.message?.chat?.id;
  const userId = cq?.from?.id;

  const handled = await handleCodexUi(
    env, chatId, userId,
    { cbData: cq.data },
    { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens }
  );

  const token = env.TELEGRAM_BOT_TOKEN;
  if (token) {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: cq.id })
    });
  }

  return handled;
}
/* ============== MAIN WEBHOOK HANDLER ============== */

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

  /* ========= CALLBACK QUERY ========= */
  if (update.callback_query) {
    const done = await handleCallback(env, update);
    return json({ ok: true });
  }

  /* ========== MESSAGE ========== */
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
        await sendPlain(env, chatId, `❌ Error: ${String(e).slice(0, 200)}`);
      } else {
        await sendPlain(env, chatId, "Сталася помилка, спробуй ще раз.");
      }
    }
  };

  /* ========== LOCATION SAVE ========== */
  if (msg?.location) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, "📍 Локацію збережено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  /* ========== /start ========== */
  if (textRaw === "/start") {
    await setCodexMode(env, userId, false);
    const name = msg?.from?.first_name || "друже";

    await sendPlain(
      env,
      chatId,
      `Привіт, ${name}! Як я можу допомогти?`,
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }

  /* ========== Senti on ========== */
  if (textRaw === BTN_SENTI || /^\/senti\b/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);

    await sendPlain(env, chatId, "🟣 Режим Senti активовано.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  /* ========== Drive-mode toggle ========== */
  if (textRaw === BTN_DRIVE) {
    await setDriveMode(env, userId, true);
    await setCodexMode(env, userId, false);

    await sendPlain(
      env,
      chatId,
      "☁️ Усе, що надішлеш — зберігатиму у Google Drive.",
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }

  /* ========== Admin panel ========== */
  if (textRaw === "/admin" || textRaw === BTN_ADMIN) {
    const checklist = abs(env, "/admin/checklist/html");
    const energy = abs(env, "/admin/energy/html");
    const learn = abs(env, "/admin/learn/html");

    const mo = String(env.MODEL_ORDER || "").trim();

    const body = [
      "Admin panel:",
      `MODEL_ORDER: ${mo || "(not set)"}`,
      `Gemini: ${env.GEMINI_API_KEY ? "✅" : "❌"}`,
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

    return json({ ok: true });
  }

  /* ========== Codex ON ========== */
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
      "🧠 *Senti Codex увімкнено.* Обери або створи проєкт.",
      { reply_markup: buildCodexKeyboard(false), parse_mode: "Markdown" }
    );
    return json({ ok: true });
  }

  /* ========== Codex OFF ========== */
  if (textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await clearCodexMem(env, userId);

    await sendPlain(env, chatId, "🔕 Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }
/* ======================================================
      MEDIA LAYER (Drive / Vision before Codex)
   ====================================================== */

const hasMedia = (msg) => {
  return !!(detectAttachment(msg) || (msg.photo?.length));
};

async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  let tokensOK = false;
  try {
    tokensOK = !!(await getUserTokens(env, userId));
  } catch {}

  if (!tokensOK) {
    const url = abs(env, "/auth/drive");
    await sendPlain(env, chatId, "Підключи Google Drive:", {
      reply_markup: {
        inline_keyboard: [[{ text: "Підключити Drive", url }]],
      },
    });
    return true;
  }

  const energy = await getEnergy(env, userId);
  const need = Number(energy.costImage ?? 5);

  if ((energy.energy ?? 0) < need) {
    const links = TG.energyLinks(env, userId);
    await sendPlain(env, chatId, `⚡ Потрібно ${need} енергії.\n${links.energy}`);
    return true;
  }

  await spendEnergy(env, userId, need, "media");

  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);

  await sendPlain(env, chatId, `📁 Збережено у Drive: ${saved?.name || att.name}`, {
    reply_markup: {
      inline_keyboard: [[{ text: "Відкрити Drive", url: "https://drive.google.com/drive/my-drive" }]],
    },
  });

  return true;
}

/* ======================================================
      CODEX MODE: TEXT HANDLER (proj_name, idea, tasks)
   ====================================================== */

async function codexConsumeText(env, chatId, userId, textRaw) {
  const consumed = await handleCodexText(
    env,
    { chatId, userId, textRaw },
    {
      sendPlain,
      sendInline: sendPlain,
    }
  );

  return consumed;
}

/* ======================================================
      CODEX MODE: MEDIA INSIDE PROJECT
   ====================================================== */

async function codexConsumeMedia(env, msg, chatId, userId) {
  const att = detectAttachment(msg);
  if (!att) return false;

  const consumed = await handleCodexMedia(
    env,
    {
      chatId,
      userId,
      fileUrl: null,
      fileName: att.name,
    },
    { sendPlain }
  );

  return consumed;
}

/* ======================================================
      MEDIA BEFORE CODEX (Vision)
   ====================================================== */

async function processMediaLayer(env, msg, chatId, userId, lang) {
  const media = detectAttachment(msg);
  if (!media && !msg.photo?.length) return false;

  const driveOn = await getDriveMode(env, userId);
  const codexOn = await getCodexMode(env, userId);

  // === DRIVE MODE ===
  if (driveOn && !codexOn) {
    return await handleIncomingMedia(env, chatId, userId, msg, lang);
  }

  // === VISION MODE (Senti Vision) ===
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
        energyLinks: TG.energyLinks,
      }
    );
    if (ok) return true;
  }

  return false;
}
/* ======================================================
      WEATHER / DATE / TIME
   ====================================================== */

async function processDateTimeWeather(env, chatId, userId, textRaw, lang) {
  const wantsDate = dateIntent(textRaw);
  const wantsTime = timeIntent(textRaw);
  const wantsWeather = weatherIntent(textRaw);

  if (!wantsDate && !wantsTime && !wantsWeather) return false;

  // DATE
  if (wantsDate) {
    await sendPlain(env, chatId, replyCurrentDate(env, lang));
  }

  // TIME
  if (wantsTime) {
    await sendPlain(env, chatId, replyCurrentTime(env, lang));
  }

  // WEATHER
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

/* ======================================================
      CODEX MAIN GENERATION
   ====================================================== */

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
      energyLinks: TG.energyLinks,
      sendPlain,
      pickPhoto: (m) =>
        m.photo?.length
          ? {
              type: "photo",
              file_id: m.photo[m.photo.length - 1].file_id,
              name: `photo_${m.photo[m.photo.length - 1].file_unique_id}.jpg`,
            }
          : null,
      tgFileUrl,
      urlToBase64,
      describeImage: null,
      sendDocument,
      startPuzzleAnimation: async () => {},
      editMessageText: async () => {},
      driveSaveFromUrl,
      getUserTokens,
    }
  );
}

/* ======================================================
      SENTI — MAIN LLM PIPELINE
   ====================================================== */

async function runSentiLLM(env, chatId, userId, textRaw, lang) {
  const energy = await getEnergy(env, userId);
  const need = Number(energy.costText ?? 1);

  if ((energy.energy ?? 0) < need) {
    const links = TG.energyLinks(env, userId);
    await sendPlain(env, chatId, `⚡ Потрібно ${need} енергії.\n${links.energy}`);
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

/* ======================================================
      FALLBACK + FINAL ROUTING
   ====================================================== */

  // === MEDIA BEFORE CODEX ===
  const processedMedia = await processMediaLayer(env, msg, chatId, userId, lang);
  if (processedMedia) return json({ ok: true });

  // === CODEX MODE TEXT (proj_name / idea / task) ===
  const codexOn = await getCodexMode(env, userId);
  if (codexOn) {
    const consumedText = await codexConsumeText(env, chatId, userId, textRaw);
    if (consumedText) return json({ ok: true });
  }

  // === EXTRA CODEX COMMANDS ===
  if (codexOn) {
    const ok = await handleCodexCommand(
      env,
      { chatId, userId, msg, textRaw, lang },
      { sendPlain }
    );
    if (ok) return json({ ok: true });
  }

  // === CODEX MEDIA ===
  if (codexOn && hasMedia(msg)) {
    const ok = await codexConsumeMedia(env, msg, chatId, userId);
    if (ok) return json({ ok: true });
  }

  // === CODEX MAIN GENERATION ===
  if (codexOn && (textRaw || hasMedia(msg))) {
    await runCodexGeneration(env, chatId, userId, msg, textRaw, lang, isAdmin);
    return json({ ok: true });
  }

  // === WEATHER / DATE / TIME ===
  if (await processDateTimeWeather(env, chatId, userId, textRaw, lang)) {
    return json({ ok: true });
  }

  // === SENTI (LLM) ===
  if (textRaw && !textRaw.startsWith("/")) {
    await runSentiLLM(env, chatId, userId, textRaw, lang);
    return json({ ok: true });
  }

  // === DEFAULT ANSWER ===
  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });

  return json({ ok: true });
}
