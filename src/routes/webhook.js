// src/routes/webhook.js — Senti Hybrid 2.5 (Compact, fixed imports)

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

// Modes
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

// Vision
import { handleVisionMedia } from "../lib/visionHandler.js";

// Telegram helpers
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

/* ============== TG UTILS ============== */

async function sendTyping(env, chatId) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

function detectAttachment(msg) {
  if (!msg) return null;

  if (msg.document) {
    return {
      type: "document",
      file_id: msg.document.file_id,
      name: msg.document.file_name,
    };
  }

  if (Array.isArray(msg.photo) && msg.photo.length) {
    const p = msg.photo[msg.photo.length - 1];
    return {
      type: "photo",
      file_id: p.file_id,
      name: `photo_${p.file_unique_id}.jpg`,
    };
  }

  return null;
}

async function tgFileUrl(env, file_id) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN missing");

  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id }),
  });

  const data = await r.json().catch(() => null);
  if (!data?.ok || !data.result?.file_path) {
    throw new Error("getFile failed");
  }

  return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
}

/* ============== FILE / BINARY HELPERS ============== */

async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image failed: ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

async function sendDocument(env, chatId, filename, content, caption) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN missing for sendDocument");

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  const file = new File([content], filename, { type: "text/markdown" });
  fd.append("document", file);
  if (caption) fd.append("caption", caption);

  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: fd,
  });
}

/* ============== INLINE CODEX UI CALLBACKS ============== */

async function handleCallback(env, update) {
  const cq = update.callback_query;
  const chatId = cq?.message?.chat?.id;
  const userId = cq?.from?.id;

  const handled = await handleCodexUi(
    env,
    chatId,
    userId,
    { cbData: cq.data },
    { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens },
  );

  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (token) {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: cq.id }),
    });
  }

  return handled;
}

/* ============== MEDIA LAYER (Drive / Vision) ============== */

const hasMedia = (msg) =>
  !!(detectAttachment(msg) || (Array.isArray(msg?.photo) && msg.photo.length));

async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  let tokensOK = false;
  try {
    tokensOK = !!(await getUserTokens(env, userId));
  } catch {
    tokensOK = false;
  }

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

  await sendPlain(
    env,
    chatId,
    `📁 Збережено у Drive: ${saved?.name || att.name}`,
    {
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
    },
  );

  return true;
}

async function processMediaLayer(env, msg, chatId, userId, lang) {
  const media = detectAttachment(msg);
  const anyPhoto = Array.isArray(msg?.photo) && msg.photo.length;
  if (!media && !anyPhoto) return false;

  const driveOn = await getDriveMode(env, userId);
  const codexOn = await getCodexMode(env, userId);

  // DRIVE MODE (no Codex)
  if (driveOn && !codexOn) {
    return await handleIncomingMedia(env, chatId, userId, msg, lang);
  }

  // VISION MODE (plain Senti)
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

/* ============== DATE / TIME / WEATHER ============== */

async function processDateTimeWeather(env, chatId, userId, textRaw, lang) {
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
        const byCoord = await weatherSummaryByCoords(
          env,
          saved.lat,
          saved.lon,
          lang,
        );
        await sendPlain(env, chatId, byCoord.text, {
          parse_mode: byCoord.mode || undefined,
        });
      } else {
        const geo = await getUserLocation(env, userId);
        if (geo?.lat && geo?.lon) {
          const byCoord = await weatherSummaryByCoords(
            env,
            geo.lat,
            geo.lon,
            lang,
          );
          await sendPlain(env, chatId, byCoord.text, {
            parse_mode: byCoord.mode || undefined,
          });
        } else {
          await sendPlain(
            env,
            chatId,
            "Надішли локацію — і я покажу погоду.",
            { reply_markup: askLocationKeyboard() },
          );
        }
      }
    }
  }

  return true;
}

/* ============== CODEX HELPERS ============== */

async function codexConsumeText(env, chatId, userId, textRaw) {
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

async function runCodexGeneration(
  env,
  chatId,
  userId,
  msg,
  textRaw,
  lang,
  isAdmin,
) {
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
      pickPhoto: (m) =>
        Array.isArray(m?.photo) && m.photo.length
          ? {
              type: "photo",
              file_id: m.photo[m.photo.length - 1].file_id,
              name: `photo_${
                m.photo[m.photo.length - 1].file_unique_id
              }.jpg`,
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
    },
  );
}
/* ============== SENTI CORE LLM PIPELINE ============== */

async function runSentiLLM(env, chatId, userId, textRaw, lang) {
  const energy = await getEnergy(env, userId);
  const need = Number(energy.costText ?? 1);

  if ((energy.energy ?? 0) < need) {
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

/* ============== MAIN WEBHOOK HANDLER ============== */

export async function handleTelegramWebhook(req, env) {
  if (req.method === "GET") {
    return json({ ok: true, worker: "senti", ts: Date.now() });
  }

  // Validate Telegram secret for POST
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

  // Inline Codex UI callbacks
  if (update.callback_query) {
    await handleCallback(env, update);
    return json({ ok: true });
  }

  // Base message info
  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const isAdmin = ADMIN(env, userId, msg?.from?.username);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const lang = msg?.from?.language_code || "uk";

  /* ========== LOCATION SAVE ========== */
  if (msg?.location && userId && chatId) {
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

    await sendPlain(env, chatId, `Привіт, ${name}! Як я можу допомогти?`, {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  /* ========== Senti ON ========== */
  if (textRaw === BTN_SENTI || /^\/senti\b/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);

    await sendPlain(env, chatId, "🟣 Режим Senti активовано.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  /* ========== Drive-mode ON ========== */
  if (textRaw === BTN_DRIVE) {
    await setDriveMode(env, userId, true);
    await setCodexMode(env, userId, false);

    await sendPlain(
      env,
      chatId,
      "☁️ Усе, що надішлеш — зберігатиму у Google Drive.",
      { reply_markup: mainKeyboard(isAdmin) },
    );
    return json({ ok: true });
  }

  /* ========== Admin panel ========== */
  if (textRaw === "/admin" || textRaw === BTN_ADMIN) {
    const checklist = abs(env, "/admin/checklist/html");
    const energyUrl = abs(env, "/admin/energy/html");
    const learn = abs(env, "/admin/learn/html");

    const mo = String(env.MODEL_ORDER || "").trim();

    const body = [
      "*Admin panel (quick diagnostics):*",
      `MODEL_ORDER: ${mo || "(not set)"}`,
      `Gemini API: ${env.GEMINI_API_KEY ? "✅" : "❌"}`,
      `Cloudflare: ${env.CLOUDFLARE_API_TOKEN ? "✅" : "❌"}`,
      `OpenRouter: ${env.OPENROUTER_API_KEY ? "✅" : "❌"}`,
      `FreeLLM: ${env.FREELLM_API_KEY ? "✅" : "❌"}`,
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
      "🧠 *Senti Codex увімкнено.* Обери проєкт або створи новий.",
      { reply_markup: buildCodexKeyboard(false), parse_mode: "Markdown" },
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

  /* ========== MEDIA (Drive / Vision, when Codex OFF) ========== */
  const processedMedia = await processMediaLayer(env, msg, chatId, userId, lang);
  if (processedMedia) return json({ ok: true });

  /* ========== CODEX MODE ========== */
  const codexOn = await getCodexMode(env, userId);

  if (codexOn) {
    const consumedText = await codexConsumeText(env, chatId, userId, textRaw);
    if (consumedText) return json({ ok: true });

    const handledCmd = await handleCodexCommand(
      env,
      { chatId, userId, msg, textRaw, lang },
      { sendPlain },
    );
    if (handledCmd) return json({ ok: true });

    if (hasMedia(msg)) {
      const consumedMedia = await codexConsumeMedia(
        env,
        msg,
        chatId,
        userId,
      );
      if (consumedMedia) return json({ ok: true });
    }

    if (textRaw || hasMedia(msg)) {
      await runCodexGeneration(env, chatId, userId, msg, textRaw, lang, isAdmin);
      return json({ ok: true });
    }
  }

  /* ========== DATE / TIME / WEATHER ========== */
  if (await processDateTimeWeather(env, chatId, userId, textRaw, lang)) {
    return json({ ok: true });
  }

  /* ========== SENTI LLM (default text) ========== */
  if (textRaw && !textRaw.startsWith("/")) {
    await runSentiLLM(env, chatId, userId, textRaw, lang);
    return json({ ok: true });
  }

  /* ========== FALLBACK ========== */
  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });

  return json({ ok: true });
}