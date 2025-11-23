// src/routes/webhook.js — Senti Hybrid 3.0 (Optimized Edition)

// ================== CORE ==================
import { json } from "../lib/utils.js";
import { TG } from "../lib/tg.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { pushTurn, buildDialogHint } from "../lib/dialogMemory.js";
import { autoUpdateSelfTune } from "../lib/selfTune.js";
import { abs } from "../utils/url.js";

// ================ PROVIDERS =================
import { askAnyModel } from "../lib/modelRouter.js";
import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";

// ================ GEO & WEATHER ==============
import { setUserLocation, getUserLocation } from "../lib/geo.js";
import { saveLastPlace, loadLastPlace } from "../apis/userPrefs.js";

import {
  dateIntent,
  timeIntent,
  replyCurrentDate,
  replyCurrentTime
} from "../apis/time.js";

import {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords
} from "../apis/weather.js";

// ================== MODES ====================
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";

// *** FIXED PATHS for Codex ***
import {
  setCodexMode,
  getCodexMode,
  clearCodexMem,
  handleCodexCommand,
  handleCodexGeneration,
  handleCodexText,
  handleCodexMedia,
  buildCodexKeyboard,
  handleCodexUi
} from "../lib/codex/codexHandler.js";

// *** FIXED PATH for Vision ***
import { handleVisionMedia } from "../lib/vision/visionHandler.js";

const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_CODEX,
  mainKeyboard, ADMIN, sendPlain, askLocationKeyboard
} = TG;


// ============= HELPERS =============

async function sendTyping(env, chatId) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({ chat_id: chatId, action: "typing" })
  });
}

function detectAttachment(msg) {
  if (!msg) return null;

  if (msg.document)
    return {
      type: "document",
      file_id: msg.document.file_id,
      name: msg.document.file_name
    };

  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1];
    return {
      type: "photo",
      file_id: p.file_id,
      name: `photo_${p.file_unique_id}.jpg`
    };
  }

  return null;
}

async function tgFileUrl(env, file_id) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({ file_id })
  });

  const d = await r.json();
  return `https://api.telegram.org/file/bot${token}/${d?.result?.file_path}`;
}
// ============= EXTRA HELPERS =============

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

const hasMedia = (msg) => {
  return !!(detectAttachment(msg) || msg?.photo?.length);
};

const noopAsync = async () => {};

// Admin links with secret
function buildAdminLinks(env, userId) {
  const base = (path) => abs(env, path);

  const secret =
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    "senti1984";

  const checklist = `${base("/admin/checklist/html")}?s=${encodeURIComponent(
    secret
  )}&u=${userId}`;
  const energy = `${base("/admin/energy/html")}?s=${encodeURIComponent(
    secret
  )}&u=${userId}`;
  const learn = `${base("/admin/learn/html")}?s=${encodeURIComponent(
    secret
  )}&u=${userId}`;

  return { checklist, energy, learn };
}

// ============= DRIVE MEDIA HANDLER =============

async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  let tokensOK = false;
  try {
    tokensOK = !!(await getUserTokens(env, userId));
  } catch {}

  if (!tokensOK) {
    const url = abs(env, "/auth/drive");
    await sendPlain(env, chatId, "Щоб зберігати файли — підключи Google Drive.", {
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
    await sendPlain(
      env,
      chatId,
      `⚡ Недостатньо енергії для збереження файлу. Потрібно: ${need}.\n${links.energy}`
    );
    return true;
  }

  await spendEnergy(env, userId, need, "media");

  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);

  await sendPlain(
    env,
    chatId,
    `📁 Збережено у Google Drive: ${saved?.name || att.name}`,
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
    }
  );

  return true;
}

// ============= CODEX TEXT / MEDIA HELPERS =============

async function codexConsumeText(env, chatId, userId, textRaw) {
  if (!textRaw) return false;

  const consumed = await handleCodexText(
    env,
    { chatId, userId, textRaw },
    {
      sendPlain,
      sendInline: sendPlain,
    }
  );

  return !!consumed;
}

async function codexConsumeMedia(env, msg, chatId, userId) {
  const att = detectAttachment(msg);
  if (!att) return false;

  const consumed = await handleCodexMedia(
    env,
    {
      chatId,
      userId,
      fileUrl: null, // Codex сам побудує URL через свої helper-и, якщо потрібно
      fileName: att.name,
    },
    { sendPlain }
  );

  return !!consumed;
}
// ============= MEDIA LAYER (Drive / Vision before Codex) =============

async function processMediaLayer(env, msg, chatId, userId, lang) {
  if (!hasMedia(msg)) return false;

  const driveOn = await getDriveMode(env, userId);
  const codexOn = await getCodexMode(env, userId);

  // DRIVE: зберігаємо у Google Drive, якщо Codex вимкнений
  if (driveOn && !codexOn) {
    return await handleIncomingMedia(env, chatId, userId, msg, lang);
  }

  // VISION: якщо немає Drive і Codex
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

// ============= DATE / TIME / WEATHER =============

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

// ============= CODEX MAIN GENERATION =============

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
        m?.photo?.length
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
      startPuzzleAnimation: noopAsync,
      editMessageText: noopAsync,
      driveSaveFromUrl,
      getUserTokens,
    }
  );
}

// ============= SENTI — MAIN LLM PIPELINE =============

async function runSentiLLM(env, chatId, userId, textRaw, lang) {
  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);

  if ((cur.energy ?? 0) < need) {
    const links = TG.energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      `⚡ Потрібно ${need} енергії для відповіді.\n${links.energy}`
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

// ============= CALLBACK QUERY (CODEX UI) =============

async function handleCallback(env, update) {
  const cq = update.callback_query;
  const chatId = cq?.message?.chat?.id;
  const userId = cq?.from?.id;

  await handleCodexUi(
    env,
    chatId,
    userId,
    { cbData: cq.data },
    { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens }
  );

  const token = env.TELEGRAM_BOT_TOKEN;
  if (token) {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: cq.id }),
    });
  }

  return true;
}
// ============= MAIN WEBHOOK HANDLER =============

export async function handleTelegramWebhook(req, env) {
  if (req.method === "GET") {
    return json({ ok: true, worker: "senti", ts: Date.now() });
  }

  // Валідація Telegram secret
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

  // ── CALLBACK QUERY (Codex inline UI) ──
  if (update.callback_query) {
    await handleCallback(env, update);
    return json({ ok: true });
  }

  // ── MESSAGE ──
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
          `❌ Error: ${String(e?.message || e).slice(0, 200)}`
        );
      } else {
        await sendPlain(env, chatId, "Сталася помилка, спробуй ще раз.");
      }
    }
  };

  // ── ЗБЕРЕЖЕННЯ ЛОКАЦІЇ ──
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

  // ── Senti ON (вимикає Codex і Drive) ──
  if (textRaw === BTN_SENTI || /^\/senti\b/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);

    await sendPlain(env, chatId, "🟣 Режим Senti активовано.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // ── DRIVE MODE ON ──
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

  // ── ADMIN PANEL ──
  if (textRaw === "/admin" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const { checklist, energy, learn } = buildAdminLinks(env, userId);
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
    });
    return json({ ok: true });
  }

  // ── CODEX ON ──
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
      { reply_markup: buildCodexKeyboard(false), parse_mode: "Markdown" }
    );
    return json({ ok: true });
  }

  // ── CODEX OFF ──
  if (textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await clearCodexMem(env, userId);

    await sendPlain(env, chatId, "🔕 Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // ── MEDIA LAYER ДО CODEX ──
  const processedMedia = await processMediaLayer(env, msg, chatId, userId, lang);
  if (processedMedia) return json({ ok: true });

  // ── CODEX MODE ──
  const codexOn = await getCodexMode(env, userId);

  if (codexOn) {
    // 1) службовий текст (назва проєкту, idea/tasks)
    const consumedText = await codexConsumeText(env, chatId, userId, textRaw);
    if (consumedText) return json({ ok: true });

    // 2) додаткові команди (/status тощо)
    const handledCmd = await handleCodexCommand(
      env,
      { chatId, userId, msg, textRaw, lang },
      { sendPlain }
    );
    if (handledCmd) return json({ ok: true });

    // 3) медіа всередині проєкту
    if (hasMedia(msg)) {
      const consumedMedia = await codexConsumeMedia(env, msg, chatId, userId);
      if (consumedMedia) return json({ ok: true });
    }

    // 4) основна генерація (архітектура/код/документи)
    if (textRaw || hasMedia(msg)) {
      await safe(async () => {
        await runCodexGeneration(env, chatId, userId, msg, textRaw, lang, isAdmin);
      });
      return json({ ok: true });
    }
  }

  // ── DATE / TIME / WEATHER ──
  if (await processDateTimeWeather(env, chatId, userId, textRaw, lang)) {
    return json({ ok: true });
  }

  // ── SENTI LLM ──
  if (textRaw && !textRaw.startsWith("/")) {
    await safe(async () => {
      await runSentiLLM(env, chatId, userId, textRaw, lang);
    });
    return json({ ok: true });
  }

  // ── FALLBACK ──
  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });

  return json({ ok: true });
}