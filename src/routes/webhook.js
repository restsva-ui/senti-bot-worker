// src/routes/webhook.js
// (rev) мультимовність з Telegram, Gemini — перший для vision,
// admin має checklist + energy + learn, тихе перемикання режимів,
// learn-тумблери, погода, дата/час, drive/vision роутинг.
// (upd) Codex-режим для задач по коду/ботах/лендінгах.
// (upd) vision → gemini-2.5-flash.
// (upd) /codex_template … → віддаємо готові файли.
// (upd) vision follow-up по останньому фото + клавіатура + розбиття

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

// typing
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

// base64 з TG
async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// розбивач для великих повідомлень
function splitForTelegram(text, chunk = 3800) {
  if (!text) return [""];
  if (text.length <= chunk) return [text];
  const out = [];
  for (let i = 0; i < text.length; i += chunk) {
    out.push(text.slice(i, i + chunk));
  }
  return out;
}
// media helpers
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
      name: `videonote_${v.file_unique_id}.mp4`,
    };
  }
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
  if (!path) throw new Error("file_path missing");
  return `https://api.telegram.org/file/bot${token}/${path}`;
}

// learn helpers (як у тебе)
function extractFirstUrl(text = "") {
  const m = String(text || "").match(/https?:\/\/\S+/i);
  return m ? m[0] : null;
}
async function getLearnMode(env, userId) {
  try {
    return (await env.STATE_KV.get(KV.learnMode(userId))) === "on";
  } catch {
    return false;
  }
}
async function setLearnMode(env, userId, on) {
  try {
    await env.STATE_KV.put(KV.learnMode(userId), on ? "on" : "off");
  } catch {}
}

// 🔎 визначаємо, чи це питання про попереднє фото
function isVisionFollowup(text = "") {
  const s = text.toLowerCase();
  return (
    s.includes("де це") ||
    s.includes("що це") ||
    s.includes("що на фото") ||
    s.includes("це київ") ||
    s.includes("where is this") ||
    s.includes("what is on the photo") ||
    s.includes("яке це місто") ||
    s.includes("цей монумент")
  );
}

// drive-mode
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;

  let hasTokens = false;
  try {
    const tokens = await getUserTokens(env, userId);
    hasTokens = !!tokens;
  } catch {}
  if (!hasTokens) {
    const connectUrl = abs(env, "/auth/drive");
    await sendPlain(
      env,
      chatId,
      t(lang, "drive_connect_hint") ||
        "Щоб зберігати файли, підключи Google Drive.",
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: t(lang, "open_drive_btn") || "Підключити Drive",
                url: connectUrl,
              },
            ],
          ],
        },
      }
    );
    return true;
  }

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costImage ?? 5);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      t(lang, "need_energy_media", need, links.energy)
    );
    return true;
  }
  await spendEnergy(env, userId, need, "media");

  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendPlain(
    env,
    chatId,
    `✅ ${t(lang, "saved_to_drive")}: ${saved?.name || att.name}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: t(lang, "open_drive_btn"),
              url: "https://drive.google.com/drive/my-drive",
            },
          ],
        ],
      },
    }
  );
  return true;
}

// vision (2.5) — ДОДАНО клаву + розбиття
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const att = pickPhoto(msg);
  if (!att) return false;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  const isAdmin = ADMIN(env, userId);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      t(lang, "need_energy_text", need, links.energy),
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return true;
  }
  await spendEnergy(env, userId, need, "vision");

  pulseTyping(env, chatId);

  const url = await tgFileUrl(env, att.file_id);
  const imageBase64 = await urlToBase64(url);
  const prompt =
    caption ||
    (lang.startsWith("uk")
      ? "Опиши, що на зображенні, коротко і по суті."
      : "Describe the image briefly and to the point.");

  const visionOrder =
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";

  try {
    const { text } = await describeImage(env, {
      chatId,
      tgLang: msg.from?.language_code,
      imageBase64,
      question: prompt,
      modelOrder: visionOrder,
    });

    await saveVisionMem(env, userId, {
      id: att.file_id,
      url,
      caption,
      desc: text,
    });

    const chunks = splitForTelegram(`🖼️ ${text}`);
    for (const ch of chunks) {
      await sendPlain(env, chatId, ch, {
        reply_markup: mainKeyboard(isAdmin),
      });
    }

    const landmarks = detectLandmarksFromText(text, lang);
    if (landmarks && landmarks.length) {
      const lines = formatLandmarkLines(landmarks, lang);
      await sendPlain(env, chatId, lines.join("\n"), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  } catch (e) {
    if (isAdmin) {
      await sendPlain(
        env,
        chatId,
        `❌ Vision error: ${String(e.message || e).slice(0, 180)}`,
        { reply_markup: mainKeyboard(true) }
      );
    } else {
      const connectUrl = abs(env, "/auth/drive");
      await sendPlain(
        env,
        chatId,
        "Поки що не можу аналізувати фото. Можу зберегти його у Google Drive — натисни «Google Drive» або підключи Drive.",
        {
          reply_markup: {
            keyboard: mainKeyboard(false).keyboard,
            resize_keyboard: true,
          },
        }
      );
    }
  }
  return true;
}
// Codex helpers
async function getCodexMode(env, userId) {
  try {
    return (await (env.STATE_KV || env.CHECKLIST_KV).get(
      KV.codexMode(userId)
    )) === "on";
  } catch {
    return false;
  }
}
async function setCodexMode(env, userId, on) {
  try {
    await (env.STATE_KV || env.CHECKLIST_KV).put(
      KV.codexMode(userId),
      on ? "on" : "off",
      { expirationTtl: 60 * 60 * 24 * 7 }
    );
  } catch {}
}
async function runCodex(env, prompt) {
  const system =
    "Ти — Senti Codex, це той самий Senti, але у режимі розробника. Пишеш ПОВНІ файли, без ... і без скорочень. Якщо треба змінити існуючий файл — виводиш його цілком уже з правками. Пояснення — короткі.";
  const order =
    String(env.CODEX_MODEL_ORDER || env.MODEL_ORDER || "").trim() ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct";
  return await askAnyModel(env, order, prompt, { systemHint: system });
}

// SystemHint
async function buildSystemHint(env, chatId, userId, preferredLang) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId, {
    preferredLang,
  }).catch(() => null);

  const core = `You are Senti — a thoughtful, self-improving assistant and companion.
- Never claim to be an AI, model, chatbot, or a product made by any company.
- Speak naturally and human-like with warmth and clarity.
- Prefer concise, practical answers; expand only when asked.`;

  let insightsBlock = "";
  try {
    const insights = await getRecentInsights(env, { limit: 5 });
    if (insights?.length) {
      insightsBlock =
        "[Нещодавні знання]\n" +
        insights
          .map((i) => `• ${i.insight}${i.r2Key ? " [R2]" : ""}`)
          .join("\n");
    }
  } catch {}

  const blocks = [core];
  if (statut) blocks.push(`[Статут/чеклист]\n${statut}`);
  if (tune) blocks.push(`[Self-Tune]\n${tune}`);
  if (insightsBlock) blocks.push(insightsBlock);
  if (dlg) blocks.push(dlg);
  return blocks.join("\n\n");
}

// MAIN
export async function handleTelegramWebhook(req, env) {
  if (req.method === "POST") {
    const sec = req.headers.get("x-telegram-bot-api-secret-token");
    const expected =
      env.TG_WEBHOOK_SECRET ||
      env.TELEGRAM_SECRET_TOKEN ||
      env.WEBHOOK_SECRET ||
      "";
    if (expected && sec !== expected) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
  } else {
    return json({ ok: true, note: "webhook alive (GET)" });
  }

  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false }, 400);
  }

  const msg =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.callback_query?.message;
  const chatId = msg?.chat?.id || update?.callback_query?.message?.chat?.id;
  const userId = msg?.from?.id || update?.callback_query?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();

  let lang = pickReplyLanguage(msg, textRaw);

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
        try {
          await sendPlain(env, chatId, t(lang, "default_reply"));
        } catch {}
      }
    }
  };

  // геолокація
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    const okMap = {
      uk: "✅ Локацію збережено. Тепер я можу показувати погоду для вашого місця.",
      ru: "✅ Локация сохранена. Теперь я смогу показывать погоду для вашего места.",
      en: "✅ Location saved. I can now show weather for your area.",
      de: "✅ Standort gespeichert. Ich kann dir jetzt Wetter für deinen Ort zeigen.",
      fr: "✅ Position enregistrée. Je peux maintenant afficher la météo pour ta zone.",
    };
    const ok =
      okMap[(msg?.from?.language_code || lang || "uk").slice(0, 2)] ||
      okMap.uk;
    await sendPlain(env, chatId, ok, { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  // /start
  if (textRaw === "/start") {
    await safe(async () => {
      const profileLang = (msg?.from?.language_code || "")
        .slice(0, 2)
        .toLowerCase();
      const startLang = ["uk", "ru", "en", "de", "fr"].includes(profileLang)
        ? profileLang
        : lang;
      const name = msg?.from?.first_name || "друже";
      await setCodexMode(env, userId, false);
      await sendPlain(
        env,
        chatId,
        `${t(startLang, "hello_name", name)} ${t(startLang, "how_help")}`,
        {
          reply_markup: mainKeyboard(isAdmin),
        }
      );
    });
    return json({ ok: true });
  }

  // тихі перемикачі
  if (textRaw === BTN_DRIVE || /^(google\s*drive)$/i.test(textRaw)) {
    await setDriveMode(env, userId, true);
    return json({ ok: true });
  }
  if (textRaw === BTN_SENTI || /^(senti|сенті)$/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);
    return json({ ok: true });
  }
// Codex вкл
  if (textRaw === BTN_CODEX || textRaw === "/codex") {
    await safe(async () => {
      await setCodexMode(env, userId, true);
      await sendPlain(
        env,
        chatId,
        "🧠 Senti Codex увімкнено. Надішли завдання: що треба створити/переписати/згенерувати. Я одна й та сама Senti.",
        { reply_markup: mainKeyboard(isAdmin) }
      );
    });
    return json({ ok: true });
  }
  // Codex викл
  if (textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // /admin
  if (
    textRaw === "/admin" ||
    textRaw === "/admin@SentiBot" ||
    textRaw === BTN_ADMIN
  ) {
    await safe(async () => {
      const mo = String(env.MODEL_ORDER || "").trim();
      const hasGemini =
        !!(env.GEMINI_API_KEY ||
          env.GOOGLE_GEMINI_API_KEY ||
          env.GEMINI_KEY);
      const hasCF = !!(env.CLOUDFLARE_API_TOKEN && env.CF_ACCOUNT_ID);
      const hasOR = !!env.OPENROUTER_API_KEY;
      const hasFreeBase = !!(env.FREE_LLM_BASE_URL || env.FREE_API_BASE_URL);
      const hasFreeKey = !!(env.FREE_LLM_API_KEY || env.FREE_API_KEY);

      const lines = [
        t(lang, "admin_header"),
        `MODEL_ORDER: ${mo || "(not set)"}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare: ${hasCF ? "✅" : "❌"}`,
        `OpenRouter: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM: ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
      ];

      const entries = mo
        ? mo
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      if (entries.length) {
        const health = await getAiHealthSummary(env, entries);
        lines.push("\n— Health:");
        for (const h of health) {
          const light = h.cool ? "🟩" : h.slow ? "🟨" : "🟥";
          const ms = h.ewmaMs ? `${Math.round(h.ewmaMs)}ms` : "n/a";
          lines.push(
            `${light} ${h.provider}:${h.model} — ewma ${ms}, fails ${
              h.failStreak || 0
            }`
          );
        }
      }

      const links = energyLinks(env, userId);
      const kb = {
        inline_keyboard: [
          [{ text: "📋 Checklist", url: links.checklist }],
          [{ text: "⚡ Energy", url: links.energy }],
          [{ text: "🧠 Learn", url: links.learn }],
        ],
      };
      await sendPlain(env, chatId, lines.join("\n"), { reply_markup: kb });
    });
    return json({ ok: true });
  }

  // Learn
  if (textRaw === (BTN_LEARN || "Learn") || (isAdmin && textRaw === "/learn")) {
    if (!isAdmin) {
      await sendPlain(env, chatId, t(lang, "how_help"), {
        reply_markup: mainKeyboard(false),
      });
      return json({ ok: true });
    }
    await safe(async () => {
      let hasQueue = false;
      try {
        const r = await listQueued(env, { limit: 1 });
        hasQueue = Array.isArray(r)
          ? r.length > 0
          : Array.isArray(r?.items)
          ? r.items.length > 0
          : false;
      } catch {}
      const links = energyLinks(env, userId);
      const keyboard = [[{ text: "🧠 Відкрити Learn HTML", url: links.learn }]];
      if (hasQueue) {
        keyboard.push([
          {
            text: "🧠 Прокачай мозок",
            url: abs(
              env,
              `/admin/learn/run?s=${encodeURIComponent(
                env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || ""
              )}`
            ),
          },
        ]);
      }
      await sendPlain(
        env,
        chatId,
        "🧠 Режим Learn. Надішли посилання/файл — додам у чергу (якщо /learn_on).",
        { reply_markup: { inline_keyboard: keyboard } }
      );
    });
    return json({ ok: true });
  }

  // learn toggles
  if (isAdmin && textRaw === "/learn_on") {
    await setLearnMode(env, userId, true);
    await sendPlain(
      env,
      chatId,
      "🟢 Learn-режим увімкнено. Посилання та файли будуть у черзі."
    );
    return json({ ok: true });
  }
  if (isAdmin && textRaw === "/learn_off") {
    await setLearnMode(env, userId, false);
    await sendPlain(
      env,
      chatId,
      "🔴 Learn-режим вимкнено. Медіа знову працюють як раніше."
    );
    return json({ ok: true });
  }

  // авто-енк'ю learn
  if (isAdmin && (await getLearnMode(env, userId))) {
    const urlInText = extractFirstUrl(textRaw);
    if (urlInText) {
      await safe(async () => {
        await enqueueLearn(env, String(userId), {
          url: urlInText,
          name: urlInText,
        });
        await sendPlain(env, chatId, "✅ Додано в чергу Learn.");
      });
      return json({ ok: true });
    }
    const anyAtt = detectAttachment(msg);
    if (anyAtt?.file_id) {
      await safe(async () => {
        const fUrl = await tgFileUrl(env, anyAtt.file_id);
        await enqueueLearn(env, String(userId), {
          url: fUrl,
          name: anyAtt.name || "file",
        });
        await sendPlain(env, chatId, "✅ Додано в чергу Learn.");
      });
      return json({ ok: true });
    }
  }

  // media routing
  try {
    const driveOn = await getDriveMode(env, userId);
    const hasAnyMedia = !!detectAttachment(msg) || !!pickPhoto(msg);

    if (driveOn && hasAnyMedia) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang))
        return json({ ok: true });
    }

    if (!driveOn && pickPhoto(msg)) {
      if (
        await handleVisionMedia(env, chatId, userId, msg, lang, msg?.caption)
      )
        return json({ ok: true });
    }

    if (
      !driveOn &&
      (msg?.video ||
        msg?.document ||
        msg?.audio ||
        msg?.voice ||
        msg?.video_note)
    ) {
      await sendPlain(
        env,
        chatId,
        "Поки що не аналізую такі файли в цьому режимі. Увімкни «Google Drive», якщо хочеш зберігати.",
        { reply_markup: mainKeyboard(isAdmin) }
      );
      return json({ ok: true });
    }
  } catch (e) {
    if (isAdmin) {
      await sendPlain(
        env,
        chatId,
        `❌ Media error: ${String(e).slice(0, 180)}`
      );
    } else {
      await sendPlain(env, chatId, t(lang, "default_reply"));
    }
    return json({ ok: true });
  }

  // 🟣 vision follow-up: якщо питали про попереднє фото
  if (textRaw && isVisionFollowup(textRaw)) {
    const mem = await loadVisionMem(env, userId);
    const last = mem && mem.length ? mem[0] : null;
    if (last?.url) {
      const imgB64 = await urlToBase64(last.url);
      const { text } = await describeImage(env, {
        chatId,
        tgLang: msg.from?.language_code,
        imageBase64: imgB64,
        question: textRaw,
        modelOrder:
          "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct",
      });
      const chunks = splitForTelegram(`🖼️ ${text}`);
      for (const ch of chunks) {
        await sendPlain(env, chatId, ch, {
          reply_markup: mainKeyboard(isAdmin),
        });
      }
      return json({ ok: true });
    }
  }
// ===== Codex templates =====
  if (textRaw.startsWith("/codex_template")) {
    const parts = textRaw.split(/\s+/).filter(Boolean);
    const tplKey = parts[1];

    if (!tplKey) {
      const all = listCodexTemplates();
      await sendPlain(
        env,
        chatId,
        "Доступні шаблони Codex:\n" +
          all.map((k) => `• ${k}`).join("\n") +
          "\n\nВикористання: /codex_template tg-bot",
        { reply_markup: mainKeyboard(isAdmin) }
      );
      return json({ ok: true });
    }

    const tpl = getCodexTemplate(tplKey);
    if (!tpl) {
      await sendPlain(
        env,
        chatId,
        "Немає такого шаблону. Надішли /codex_template щоб побачити список.",
        { reply_markup: mainKeyboard(isAdmin) }
      );
      return json({ ok: true });
    }

    const chunks = splitForTelegram(tpl);
    for (const ch of chunks) {
      await sendPlain(env, chatId, "```" + ch + "```", {
        parse_mode: "Markdown",
      });
    }
    return json({ ok: true });
  }

  // інтенти: дата/час/погода
  if (textRaw) {
    const wantsDate = dateIntent(textRaw);
    const wantsTime = timeIntent(textRaw);
    const wantsWeather = weatherIntent(textRaw);

    if (wantsDate || wantsTime || wantsWeather) {
      await safe(async () => {
        if (wantsDate) await sendPlain(env, chatId, replyCurrentDate(env, lang));
        if (wantsTime) await sendPlain(env, chatId, replyCurrentTime(env, lang));

        if (wantsWeather) {
          const byPlace = await weatherSummaryByPlace(env, textRaw, lang);
          const notFound = /Не вдалося знайти такий населений пункт\./.test(
            byPlace.text
          );
          if (!notFound) {
            await sendPlain(env, chatId, byPlace.text, {
              parse_mode: byPlace.mode || undefined,
            });
          } else {
            const geo = await getUserLocation(env, userId);
            if (geo?.lat && geo?.lon) {
              const byCoords = await weatherSummaryByCoords(
                geo.lat,
                geo.lon,
                lang
              );
              await sendPlain(env, chatId, byCoords.text, {
                parse_mode: byCoords.mode || undefined,
              });
            } else {
              await sendPlain(
                env,
                chatId,
                "Будь ласка, надішли локацію — і я покажу погоду.",
                {
                  reply_markup: askLocationKeyboard(),
                }
              );
            }
          }
        }
      });
      return json({ ok: true });
    }
  }

  // Codex режим: якщо увімкнено — все йде в Codex
  const codexOn = await getCodexMode(env, userId);
  if (codexOn && textRaw) {
    await safe(async () => {
      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 2);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(
          env,
          chatId,
          t(lang, "need_energy_text", need, links.energy)
        );
        return;
      }
      await spendEnergy(env, userId, need, "codex");
      pulseTyping(env, chatId);

      const ans = await runCodex(env, textRaw);
      await pushTurn(env, userId, "user", textRaw);
      await pushTurn(env, userId, "assistant", ans);

      const parts = splitForTelegram(ans);
      for (const p of parts) {
        await sendPlain(env, chatId, p);
      }
    });
    return json({ ok: true });
  }

  // звичайний текст → AI
  if (textRaw && !textRaw.startsWith("/")) {
    await safe(async () => {
      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(
          env,
          chatId,
          t(lang, "need_energy_text", need, links.energy)
        );
        return;
      }
      await spendEnergy(env, userId, need, "text");
      pulseTyping(env, chatId);

      await pushTurn(env, userId, "user", textRaw);
      await autoUpdateSelfTune(env, userId, lang).catch(() => {});

      const systemHint = await buildSystemHint(env, chatId, userId, lang);

      const reply = await think(env, {
        prompt: textRaw,
        userId,
        chatId,
        systemHint,
      });

      await pushTurn(env, userId, "assistant", reply);

      const chunks = splitForTelegram(reply);
      for (const c of chunks) {
        await sendPlain(env, chatId, c, {
          reply_markup: mainKeyboard(isAdmin),
        });
      }
    });
    return json({ ok: true });
  }

  // дефолт
  await sendPlain(
    env,
    chatId,
    `${t(lang, "hello_name", msg?.from?.first_name || "друже")} ${t(
      lang,
      "how_help"
    )}`,
    { reply_markup: mainKeyboard(isAdmin) }
  );
  return json({ ok: true });
}