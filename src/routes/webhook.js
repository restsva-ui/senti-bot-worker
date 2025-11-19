// =====================================================
// src/routes/webhook.js
// Повна стабільна версія з Vision-C, Codex-Fix, Weather-Fix
// Основа: webhook (41)
// =====================================================

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { autoUpdateSelfTune } from "../lib/selfTune.js";
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

// Codex
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

/* =====================================================
   Vision-C  — розумний модуль аналізу фото
   — OCR якщо є текст
   — опис якщо це сцена
   — не активується у Codex-режимі
===================================================== */

async function runVisionC(env, base64, lang) {
  const modelOrder =
    env.VISION_MODEL ||
    "cf:@cf/meta/llama-3.2-11b-vision-instruct, openrouter:google/gemini-2.0-flash-lite";

  const prompt =
    `You are Senti Vision.\n` +
    `Analyze the image. FIRST decide:\n` +
    `- If there is readable text → Answer ONLY { "mode":"ocr", "text":"..." }\n` +
    `- If it's a scene/object → Answer ONLY { "mode":"describe", "text":"..." }\n` +
    `Text must be concise and in the user's language (${lang}).`;

  const res = await askAnyModel(
    env,
    modelOrder,
    [
      { role: "system", content: prompt },
      { role: "user", content: [{ type: "input_image", image: base64 }] },
    ],
    {}
  );

  try {
    if (typeof res === "string") return JSON.parse(res);
    const txt =
      res?.choices?.[0]?.message?.content ||
      res?.text ||
      JSON.stringify(res);
    return JSON.parse(txt);
  } catch {
    return { mode: "describe", text: "На зображенні бачу сцену, але деталі розпізнати не вдалося." };
  }
}

/* =====================================================
   Telegram → реальний URL файлу
===================================================== */

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

/* =====================================================
   Завантаження → Base64
===================================================== */
async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("fetch image failed");

  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);

  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

/* =====================================================
   Виявлення медіа з Telegram
===================================================== */
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
    return { type: "video", file_id: msg.video.file_id, name: msg.video.file_name };
  }
  if (msg.audio) {
    return { type: "audio", file_id: msg.audio.file_id, name: msg.audio.file_name };
  }
  if (msg.voice) {
    return { type: "voice", file_id: msg.voice.file_id, name: `voice_${msg.voice.file_unique_id}.ogg` };
  }
  if (msg.video_note) {
    return { type: "video_note", file_id: msg.video_note.file_id, name: `video_note_${msg.video_note.file_unique_id}.mp4` };
  }

  return pickPhoto(msg);
}
/* =====================================================
   Транслітерація українських міст → англійською
   для коректної роботи weather API
===================================================== */

const UA_MAP = {
  "київ": "Kyiv",
  "харків": "Kharkiv",
  "дніпро": "Dnipro",
  "одеса": "Odesa",
  "львів": "Lviv",
  "вінниця": "Vinnytsia",
  "полтава": "Poltava",
  "чернігів": "Chernihiv",
  "житомир": "Zhytomyr",
  "черкаси": "Cherkasy",
  "суми": "Sumy",
  "ривне": "Rivne",
  "ужгород": "Uzhhorod",
  "миколаїв": "Mykolaiv",
  "хмельницький": "Khmelnytskyi",
  "луцьк": "Lutsk",
  "івано-франківськ": "Ivano-Frankivsk",
  "тернопіль": "Ternopil",
  "херсон": "Kherson",
  "чернівці": "Chernivtsi"
};

function translitUAPlace(text) {
  const low = text.toLowerCase().trim();
  return UA_MAP[low] || text;
}

/* =====================================================
   ADMIN LINKS
===================================================== */

function buildAdminLinks(env, userId) {
  const base = (path) => abs(env, path);
  const secret =
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    "senti1984";

  return {
    checklist:
      base("/admin/checklist/html") +
      `?s=${encodeURIComponent(secret)}&u=${userId}`,
    energy:
      base("/admin/energy/html") +
      `?s=${encodeURIComponent(secret)}&u=${userId}`,
    learn:
      base("/admin/learn/html") +
      `?s=${encodeURIComponent(secret)}&u=${userId}`,
  };
}

/* =====================================================
   SYSTEM HINT FOR SENTI
===================================================== */

async function buildSystemHint(env, chatId, userId, lang) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);

  const core = `You are Senti — personal assistant.
- Reply in user's language.
- Be concise and helpful.`;

  const parts = [core];
  if (statut) parts.push(`[Статут]\n${statut}`);
  if (dlg) parts.push(dlg);

  return parts.join("\n\n");
}

/* =====================================================
   ГОЛОВНИЙ WEBHOOK
===================================================== */

export async function handleTelegramWebhook(req, env) {
  if (req.method === "GET") {
    return json({ ok: true, worker: "senti", ts: Date.now() });
  }

  if (req.method === "POST") {
    const expected =
      env.TG_WEBHOOK_SECRET ||
      env.TELEGRAM_SECRET_TOKEN ||
      env.WEBHOOK_SECRET ||
      "";

    if (expected) {
      const sec = req.headers.get("x-telegram-bot-api-secret-token");
      if (sec !== expected)
        return json({ ok: false, error: "unauthorized" }, 401);
    }
  }

  const update = await req.json();

  /* =====================================================
     INLINE — Codex UI
  ====================================================== */

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

  /* =====================================================
     MAIN MESSAGE FLOW
  ====================================================== */

  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const isAdmin = ADMIN(env, userId, msg?.from?.username);

  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const userLang = msg?.from?.language_code || "uk";
  const lang = pickReplyLanguage(msg, textRaw);

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

  /* =====================================================
     SAVE LOCATION
  ====================================================== */
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, "🏷️ Локацію збережено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  /* =====================================================
     /start (RESET)
  ====================================================== */

  if (textRaw === "/start") {
    await setCodexMode(env, userId, false);
    const name = msg?.from?.first_name || "друже";

    await sendPlain(env, chatId, `Привіт, ${name}! 👋`, {
      reply_markup: mainKeyboard(isAdmin),
    });

    return json({ ok: true });
  }

  /* =====================================================
     FORCE SENTI
  ====================================================== */

  if (textRaw === BTN_SENTI || /^\/senti\b/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);

    await sendPlain(env, chatId, "🟣 Режим Senti активовано.", {
      reply_markup: mainKeyboard(isAdmin),
    });

    return json({ ok: true });
  }

  /* =====================================================
     DRIVE MODE ON
  ====================================================== */

  if (textRaw === BTN_DRIVE) {
    await setDriveMode(env, userId, true);
    await setCodexMode(env, userId, false);

    await sendPlain(env, chatId, "☁️ Тепер усе, що надішлеш — зберігатиму у Google Drive.", {
      reply_markup: mainKeyboard(isAdmin),
    });

    return json({ ok: true });
  }

  /* =====================================================
     ADMIN PANEL
  ====================================================== */

  if (textRaw === "/admin" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const { checklist, energy, learn } = buildAdminLinks(env, userId);
      const mo = String(env.MODEL_ORDER || "").trim();

      const body = [
        "⚙️ *Admin Panel*",
        `MODEL_ORDER: ${mo || "(not set)"}`,
        `Gemini API: ${env.GEMINI_API_KEY ? "✅" : "❌"}`,
        `Cloudflare Token: ${env.CLOUDFLARE_API_TOKEN ? "✅" : "❌"}`,
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
    });

    return json({ ok: true });
  }

  /* =====================================================
     CODEX ON
  ====================================================== */

  if (textRaw === BTN_CODEX || textRaw === "/codex") {
    if (!isAdmin) {
      await sendPlain(env, chatId, "🛡️ Доступ до Codex лише для адміна.");
      return json({ ok: true });
    }

    await setCodexMode(env, userId, true);
    await clearCodexMem(env, userId);

    await sendPlain(
      env,
      chatId,
      "🧠 *Senti Codex увімкнено.*\n\nОбери проєкт або створи новий.",
      { reply_markup: buildCodexKeyboard(false) }
    );

    return json({ ok: true });
  }

  /* =====================================================
     CODEX OFF
  ====================================================== */

  if (textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await clearCodexMem(env, userId);

    await sendPlain(env, chatId, "🔕 Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });

    return json({ ok: true });
  }
/* =====================================================
     MEDIA FIRST LAYER (Drive / Vision-C)
     — якщо Codex вимкнено
  ====================================================== */

  const hasMedia = !!detectAttachment(msg) || !!pickPhoto(msg);
  const driveOn = await getDriveMode(env, userId);
  const codexOn = await getCodexMode(env, userId);

  if (hasMedia && !codexOn) {
    // DRIVE MODE
    if (driveOn) {
      const okDrive = await handleIncomingMedia(env, chatId, userId, msg, lang);
      if (okDrive) return json({ ok: true });
    }

    // PHOTO → VISION-C
    const att = detectAttachment(msg) || pickPhoto(msg);

    if (att?.file_id) {
      try {
        const url = await tgFileUrl(env, att.file_id);
        const base64 = await urlToBase64(url);

        // Energy
        const cur = await getEnergy(env, userId);
        const need = Number(cur.costImage ?? 4);
        if ((cur.energy ?? 0) < need) {
          const links = energyLinks(env, userId);
          await sendPlain(
            env,
            chatId,
            t(lang, "need_energy_media", need, links.energy)
          );
          return json({ ok: true });
        }
        await spendEnergy(env, userId, need, "vision");

        // RUN Vision-C
        const vis = await runVisionC(env, base64, lang);

        if (vis.mode === "ocr") {
          await sendPlain(env, chatId, `📄 *Текст із зображення:*\n\n${vis.text}`);
        } else {
          await sendPlain(env, chatId, `🖼️ *Опис фото:*\n\n${vis.text}`);
        }

        return json({ ok: true });
      } catch (e) {
        await sendPlain(env, chatId, "Не вдалося обробити фото.");
        return json({ ok: true });
      }
    }
  }

  /* =====================================================
     DATE / TIME / WEATHER
  ====================================================== */

  const wantsDate = dateIntent(textRaw);
  const wantsTime = timeIntent(textRaw);
  const wantsWeather = weatherIntent(textRaw);

  if (wantsDate || wantsTime || wantsWeather) {
    await safe(async () => {
      if (wantsDate) {
        await sendPlain(env, chatId, replyCurrentDate(env, lang));
      }
      if (wantsTime) {
        await sendPlain(env, chatId, replyCurrentTime(env, lang));
      }

      if (wantsWeather) {
        const place = translitUAPlace(textRaw);

        let resp = await weatherSummaryByPlace(env, place, lang);

        if (!/Не вдалося знайти/.test(resp.text)) {
          await sendPlain(env, chatId, resp.text, {
            parse_mode: resp.mode || undefined,
          });
          await saveLastPlace(env, userId, { place });
          return;
        }

        const last = await loadLastPlace(env, userId);
        if (last?.lat && last?.lon) {
          const byCoord = await weatherSummaryByCoords(last.lat, last.lon, lang);
          await sendPlain(env, chatId, byCoord.text, {
            parse_mode: byCoord.mode || undefined,
          });
          return;
        }

        const geo = await getUserLocation(env, userId);
        if (geo?.lat && geo?.lon) {
          const byCoord = await weatherSummaryByCoords(geo.lat, geo.lon, lang);
          await sendPlain(env, chatId, byCoord.text, {
            parse_mode: byCoord.mode || undefined,
          });
          return;
        }

        await sendPlain(
          env,
          chatId,
          "Надішли локацію — і я покажу погоду.",
          { reply_markup: askLocationKeyboard() }
        );
      }
    });

    return json({ ok: true });
  }

  /* =====================================================
     CODEX INPUT (TEXT)
  ====================================================== */

  if (codexOn) {
    const consumedText = await handleCodexText(
      env,
      { chatId, userId, textRaw },
      { sendPlain, sendInline: sendPlain }
    );
    if (consumedText) return json({ ok: true });
  }

  /* =====================================================
     CODEX COMMANDS
  ====================================================== */

  if (codexOn) {
    const handledCmd = await handleCodexCommand(
      env,
      { chatId, userId, msg, textRaw, lang },
      { sendPlain }
    );
    if (handledCmd) return json({ ok: true });
  }

  /* =====================================================
     CODEX MEDIA → progress.md
  ====================================================== */

  if (codexOn && hasMedia) {
    const att = detectAttachment(msg) || pickPhoto(msg);

    const consumedMedia = await handleCodexMedia(
      env,
      {
        chatId,
        userId,
        fileUrl: null,
        fileName: att?.name,
      },
      { sendPlain }
    );

    if (consumedMedia) return json({ ok: true });
  }

  /* =====================================================
     CODEX MAIN GENERATION
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

  /* =====================================================
     SENTI NORMAL DIALOG
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
      await pushTurn(env, userId, "user", textRaw);

      await autoUpdateSelfTune(env, userId, lang).catch(() => {});
      const systemHint = await buildSystemHint(env, chatId, userId, lang);

      const order =
        env.MODEL_ORDER ||
        "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct";

      const res = await askAnyModel(env, order, textRaw, { systemHint });
      const full =
        (typeof res === "string"
          ? res
          : res?.choices?.[0]?.message?.content) || "Не впевнений.";

      await sendPlain(env, chatId, full);
      await pushTurn(env, userId, "assistant", full);
    });

    return json({ ok: true });
  }

  /* =====================================================
     FALLBACK
  ====================================================== */

  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });

  return json({ ok: true });
}