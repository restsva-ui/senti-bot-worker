// src/routes/webhook.js — Senti Webhook 3.0 (A-mode)

import { json } from "../lib/utils.js";
import { TG } from "../lib/tg.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { pushTurn, buildDialogHint } from "../lib/dialogMemory.js";
import { autoUpdateSelfTune } from "../lib/selfTune.js";
import { abs } from "../utils/url.js";

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";

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

import {
  setDriveMode, getDriveMode
} from "../lib/driveMode.js";

import {
  setCodexMode, getCodexMode, clearCodexMem,
  handleCodexText, handleCodexCommand,
  handleCodexUi, handleCodexGeneration,
  handleCodexMedia, buildCodexKeyboard
} from "../lib/codexHandler.js";

import { handleVisionMedia } from "../lib/visionHandler.js";

const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_CODEX,
  mainKeyboard, ADMIN, sendPlain, askLocationKeyboard
} = TG;


/* ========== TG ========== */

async function sendTyping(env, chatId) {
  const t = env.TELEGRAM_BOT_TOKEN;
  if (!t) return;
  await fetch(`https://api.telegram.org/bot${t}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" })
  });
}

function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document)
    return { type: "document", file_id: msg.document.file_id, name: msg.document.file_name };
  if (msg.photo?.length) {
    const p = msg.photo[msg.photo.length - 1];
    return { type: "photo", file_id: p.file_id, name: `photo_${p.file_unique_id}.jpg` };
  }
  return null;
}

async function tgFileUrl(env, file_id) {
  const t = env.TELEGRAM_BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${t}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id })
  });
  const d = await r.json();
  return `https://api.telegram.org/file/bot${t}/${d.result.file_path}`;
}

/* ========== CALLBACK ========== */

async function handleCallback(env, update) {
  const cq = update.callback_query;
  const chatId = cq?.message?.chat?.id;
  const userId = cq?.from?.id;

  const handled = await handleCodexUi(
    env, chatId, userId,
    { cbData: cq.data },
    { sendPlain, tgFileUrl, driveSaveFromUrl, getUserTokens }
  );

  const t = env.TELEGRAM_BOT_TOKEN;
  if (t) {
    await fetch(`https://api.telegram.org/bot${t}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: cq.id })
    });
  }

  return handled;
}
/* ========== MAIN HANDLER ========== */

export async function handleTelegramWebhook(req, env) {
  if (req.method === "GET")
    return json({ ok: true, worker: "senti", ts: Date.now() });

  if (req.method === "POST") {
    const expected =
      env.TG_WEBHOOK_SECRET ||
      env.TELEGRAM_SECRET_TOKEN ||
      env.WEBHOOK_SECRET || "";
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    if (expected && sec !== expected)
      return json({ ok: false, error: "unauthorized" }, 401);
  }

  const update = await req.json();

  if (update.callback_query) {
    await handleCallback(env, update);
    return json({ ok: true });
  }

  const msg = update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const username = msg?.from?.username || "";

  const isAdmin = ADMIN(env, userId, username);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const lang = msg?.from?.language_code || "uk";

  const safe = async (fn) => {
    try { await fn(); }
    catch (e) {
      if (isAdmin) await sendPlain(env, chatId, `❌ ${String(e).slice(0,200)}`);
      else await sendPlain(env, chatId, "Сталася помилка, спробуй ще раз.");
    }
  };

  /* ========== LOCATION ========== */

  if (msg?.location) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, "📍 Локацію збережено.", {
      reply_markup: mainKeyboard(isAdmin)
    });
    return json({ ok: true });
  }

  /* ========== START ========== */

  if (textRaw === "/start") {
    await setCodexMode(env, userId, false);
    const name = msg?.from?.first_name || "друже";
    await sendPlain(env, chatId, `Привіт, ${name}! Як я можу допомогти?`, {
      reply_markup: mainKeyboard(isAdmin)
    });
    return json({ ok: true });
  }

  /* ========== SENTI ========== */

  if (textRaw === BTN_SENTI || /^\/senti\b/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "📀 Режим Senti активовано.", {
      reply_markup: mainKeyboard(isAdmin)
    });
    return json({ ok: true });
  }

  /* ========== DRIVE ========== */

  if (textRaw === BTN_DRIVE) {
    await setDriveMode(env, userId, true);
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "☁️ Все, що надішлеш — зберігатиму у Drive.", {
      reply_markup: mainKeyboard(isAdmin)
    });
    return json({ ok: true });
  }

  /* ========== ADMIN PANEL ========== */

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
      `OpenRouter: ${env.OPENROUTER_API_KEY ? "✅" : "❌"}`
    ].join("\n");

    await sendPlain(env, chatId, body, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📋 Checklist", url: checklist }],
          [{ text: "⚡ Energy", url: energy }],
          [{ text: "🧠 Learn", url: learn }]
        ]
      }
    });

    return json({ ok: true });
  }

  /* ========== CODEX ON ========== */

  if (textRaw === BTN_CODEX || textRaw === "/codex") {
    if (!isAdmin) {
      await sendPlain(env, chatId, "🛡️ Codex тільки для адміну.");
      return json({ ok: true });
    }
    await clearCodexMem(env, userId);
    await setCodexMode(env, userId, true);

    await sendPlain(env, chatId, "🧠 *Senti Codex увімкнено.*", {
      reply_markup: buildCodexKeyboard(false),
      parse_mode: "Markdown"
    });

    return json({ ok: true });
  }

  /* ========== CODEX OFF ========== */

  if (textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await clearCodexMem(env, userId);

    await sendPlain(env, chatId, "🔕 Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin)
    });
    return json({ ok: true });
  }
const att = detectAttachment(msg);
  const hasPhoto = Array.isArray(msg?.photo) && msg.photo.length > 0;
  const hasMedia = !!att || hasPhoto;

  const driveOn = await getDriveMode(env, userId);
  const codexMode = await getCodexMode(env, userId);
  const codexOn = !!codexMode && codexMode !== "off";

  const urlToBase64 = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`fetch image ${r.status}`);
    const ab = await r.arrayBuffer();
    const bytes = new Uint8Array(ab);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  };

  if (hasMedia && !codexOn) {
    await safe(async () => {
      if (driveOn) {
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
          return;
        }

        const energy = await getEnergy(env, userId);
        const need = Number(energy.costImage ?? 5);
        if ((energy.energy ?? 0) < need) {
          const links = TG.energyLinks(env, userId);
          await sendPlain(
            env,
            chatId,
            `⚡ Потрібно ${need} енергії.\n${links.energy}`
          );
          return;
        }

        await spendEnergy(env, userId, need, "media");

        const fileId = att?.file_id || (hasPhoto ? msg.photo[msg.photo.length - 1].file_id : null);
        const fileName =
          att?.name ||
          (hasPhoto
            ? `photo_${msg.photo[msg.photo.length - 1].file_unique_id}.jpg`
            : "file");

        const url = await tgFileUrl(env, fileId);
        const saved = await driveSaveFromUrl(env, userId, url, fileName);

        await sendPlain(
          env,
          chatId,
          `📁 Збережено у Drive: ${saved?.name || fileName}`,
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
        return;
      }

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

      if (!ok) {
        await sendPlain(
          env,
          chatId,
          "Не вдалося обробити зображення."
        );
      }
    });

    return json({ ok: true });
  }

  if (codexOn) {
    const consumedText = await handleCodexText(
      env,
      { chatId, userId, textRaw },
      { sendPlain, sendInline: sendPlain }
    );
    if (consumedText) return json({ ok: true });

    const cmdHandled = await handleCodexCommand(
      env,
      { chatId, userId, msg, textRaw, lang },
      { sendPlain }
    );
    if (cmdHandled) return json({ ok: true });

    if (hasMedia) {
      const fileName =
        att?.name ||
        (hasPhoto
          ? `photo_${msg.photo[msg.photo.length - 1].file_unique_id}.jpg`
          : "media");

      const consumedMedia = await handleCodexMedia(
        env,
        {
          chatId,
          userId,
          fileUrl: null,
          fileName,
        },
        { sendPlain }
      );
      if (consumedMedia) return json({ ok: true });
    }

    if (textRaw || hasMedia) {
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
            energyLinks: TG.energyLinks,
            sendPlain,
            tgFileUrl,
            urlToBase64,
            driveSaveFromUrl,
            getUserTokens,
          }
        );
      });
      return json({ ok: true });
    }
  }

  if (textRaw) {
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
          const byPlace = await weatherSummaryByPlace(env, textRaw, lang);
          if (!/Не вдалося/.test(byPlace.text)) {
            await sendPlain(env, chatId, byPlace.text, {
              parse_mode: byPlace.mode || undefined,
            });
            await saveLastPlace(env, userId, { place: textRaw });
          } else {
            const last = await loadLastPlace(env, userId);
            if (last?.lat && last?.lon) {
              const byCoord = await weatherSummaryByCoords(
                last.lat,
                last.lon,
                lang
              );
              await sendPlain(env, chatId, byCoord.text, {
                parse_mode: byCoord.mode || undefined,
              });
            } else {
              const geo = await getUserLocation(env, userId);
              if (geo?.lat && geo?.lon) {
                const byCoord = await weatherSummaryByCoords(
                  geo.lat,
                  geo.lon,
                  lang
                );
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
          }
        }
      });

      return json({ ok: true });
    }
  }
if (textRaw && !textRaw.startsWith("/")) {
    await safe(async () => {
      const energy = await getEnergy(env, userId);
      const need = Number(energy.costText ?? 1);

      if ((energy.energy ?? 0) < need) {
        const links = TG.energyLinks(env, userId);
        await sendPlain(
          env,
          chatId,
          `⚡ Потрібно ${need} енергії.\n${links.energy}`
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
    });

    return json({ ok: true });
  }

  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });

  return json({ ok: true });
}