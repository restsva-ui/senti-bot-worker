// src/flows/handleMessage.js

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
import { describeImage } from "./visionDescribe.js";
import {
  detectLandmarksFromText,
  formatLandmarkLines,
} from "../lib/landmarkDetect.js";

// --- Допоміжні константи й ключі
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

// --- Початок основного handler-а
export async function handleMessage(update, tgContext) {
  const env = tgContext.env;
  const msg = update.message;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const userLang = msg?.from?.language_code || "uk";
  let lang = pickReplyLanguage(msg, textRaw);

  // /start
  if (textRaw === "/start") {
    await setDriveMode(env, userId, false);
    await sendPlain(
      env,
      chatId,
      (lang.startsWith("uk")
        ? `Привіт, ${msg?.from?.first_name || "друже"}! Як я можу допомогти?`
        : `Hi, ${msg?.from?.first_name || "friend"}! How can I help?`),
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return new Response("OK");
  }

  // Drive ON/OFF
  if (textRaw === BTN_DRIVE) {
    await setDriveMode(env, userId, true);
    await sendPlain(env, chatId, "Drive режим увімкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return new Response("OK");
  }
  if (textRaw === BTN_SENTI) {
    await setDriveMode(env, userId, false);
    await sendPlain(env, chatId, "Senti режим увімкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return new Response("OK");
  }

  // /admin (швидка адмін-панель)
  if (textRaw === "/admin" || textRaw === BTN_ADMIN) {
    const { checklist, energy, learn } = TG.buildAdminLinks(env, userId);
    const mo = String(env.MODEL_ORDER || "").trim();
    const body = [
      "Admin panel (quick diagnostics):",
      `MODEL_ORDER: ${mo || "(not set)"}`,
      `GEMINI key: ${env.GEMINI_API_KEY ? "✅" : "❌"}`,
      `Cloudflare: ${env.CLOUDFLARE_API_TOKEN ? "✅" : "❌"}`,
      `OpenRouter: ${env.OPENROUTER_API_KEY ? "✅" : "❌"}`,
      `FreeLLM: ${env.FREE_LLM_BASE_URL ? "✅" : "❌"}`,
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
    return new Response("OK");
  }

  // /codex — увімкнути Codex
  if (textRaw === BTN_CODEX || textRaw === "/codex") {
    if (!isAdmin) {
      await sendPlain(env, chatId, "🛡️ Codex тільки для адміну.");
      return new Response("OK");
    }
    await TG.setCodexMode(env, userId, true);
    await TG.clearCodexMem(env, userId);
    await sendPlain(
      env,
      chatId,
      "🧠 Senti Codex увімкнено. Надішли задачу (наприклад: «зроби html тетріс»).",
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return new Response("OK");
  }

  // /codex_off — вимкнути Codex
  if (textRaw === "/codex_off") {
    await TG.setCodexMode(env, userId, false);
    await TG.clearCodexMem(env, userId);
    await sendPlain(env, chatId, "Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return new Response("OK");
  }

  // Дата, час, погода
  if (dateIntent(textRaw)) {
    await sendPlain(env, chatId, replyCurrentDate(env, lang));
    return new Response("OK");
  }
  if (timeIntent(textRaw)) {
    await sendPlain(env, chatId, replyCurrentTime(env, lang));
    return new Response("OK");
  }
  if (weatherIntent(textRaw)) {
    const byPlace = await weatherSummaryByPlace(env, textRaw, lang);
    if (!/Не вдалося знайти/.test(byPlace.text)) {
      await sendPlain(env, chatId, byPlace.text, {
        parse_mode: byPlace.mode || undefined,
      });
    } else {
      const geo = await getUserLocation(env, userId);
      if (geo?.lat && geo?.lon) {
        const byCoord = await weatherSummaryByCoords(geo.lat, geo.lon, lang);
        await sendPlain(env, chatId, byCoord.text, {
          parse_mode: byCoord.mode || undefined,
        });
      } else {
        await sendPlain(
          env,
          chatId,
          "Надішли локацію — і я покажу погоду.",
          { reply_markup: askLocationKeyboard() }
        );
      }
    }
    return new Response("OK");
  }

  // Звичайна генерація — AI‑відповідь (Senti-режим)
  if (textRaw && !textRaw.startsWith("/")) {
    const cur = await getEnergy(env, userId);
    const need = Number(cur.costText ?? 1);
    if ((cur.energy ?? 0) < need) {
      const links = energyLinks(env, userId);
      await sendPlain(
        env,
        chatId,
        t(lang, "need_energy_text", need, links.energy)
      );
      return new Response("OK");
    }
    await spendEnergy(env, userId, need, "text");
    await pushTurn(env, userId, "user", textRaw);
    await autoUpdateSelfTune(env, userId, lang).catch(() => {});
    const systemHint = await TG.buildSystemHint(env, chatId, userId, lang);
    const order =
      String(env.MODEL_ORDER || "").trim() ||
      "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";
    const res = await askAnyModel(env, order, textRaw, { systemHint });
    const full = TG.asText(res) || "Не впевнений.";
    await pushTurn(env, userId, "assistant", full);
    await sendPlain(env, chatId, full);
    return new Response("OK");
  }

  // Дефолтна відповідь
  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });
  return new Response("OK");
}

