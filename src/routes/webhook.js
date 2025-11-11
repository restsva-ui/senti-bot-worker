// src/routes/webhook.js

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

// ← новий імпорт для винесеного codex
import {
  setCodexMode,
  getCodexMode,
  clearCodexMem,
  handleCodexCommand,
  handleCodexGeneration,
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

const VISION_MEM_KEY = (uid) => `vision:mem:${uid}`;

// ---- vision short-memory
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

// ---- TG helpers
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
    }),
  });
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function startPuzzleAnimation(env, chatId, messageId, signal) {
  const frames = [
    "🧩 Працюю над кодом…",
    "🧩🟦 Працюю над кодом…",
    "🧩🟦🟩 Працюю над кодом…",
  ];
  let i = 0;
  while (!signal.done) {
    await sleep(1300);
    if (signal.done) break;
    try {
      await editMessageText(env, chatId, messageId, frames[i % frames.length]);
    } catch {}
    i++;
  }
}

// ---- get tg file url + attachment detection
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
// admin links
function buildAdminLinks(env, userId) {
  const base = (path) => abs(env, path);
  const secret =
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    "senti1984";

  const checklist = `${base(
    "/admin/checklist/html"
  )}?s=${encodeURIComponent(secret)}&u=${userId}`;
  const energy = `${base(
    "/admin/energy/html"
  )}?s=${encodeURIComponent(secret)}&u=${userId}`;
  const learn = `${base(
    "/admin/learn/html"
  )}?s=${encodeURIComponent(secret)}&u=${userId}`;

  return { checklist, energy, learn };
}

// drive-mode media
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
            [{ text: "Підключити Drive", url: connectUrl }],
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
    `✅ Збережено на Диск: ${saved?.name || att.name}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Відкрити Диск",
              url: "https://drive.google.com/drive/my-drive",
            },
          ],
        ],
      },
    }
  );
  return true;
}

// vision-mode (коли не Codex і не drive)
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const att = pickPhoto(msg);
  if (!att) return false;

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      t(lang, "need_energy_text", need, links.energy)
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

    await sendPlain(env, chatId, `🖼️ ${text}`);

    const landmarks = detectLandmarksFromText(text, lang);
    if (landmarks?.length) {
      const lines = formatLandmarkLines(landmarks, lang);
      await sendPlain(env, chatId, lines.join("\n"), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    }
  } catch (e) {
    if (ADMIN(env, userId)) {
      await sendPlain(
        env,
        chatId,
        `❌ Vision error: ${String(e.message || e).slice(0, 180)}`
      );
    } else {
      await sendPlain(env, chatId, "Поки що не можу проаналізувати фото.");
    }
  }
  return true;
}
// продовження src/routes/webhook.js

// system hint
async function buildSystemHint(env, chatId, userId, preferredLang) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId, { preferredLang }).catch(
    () => null
  );
  let insightsBlock = "";
  try {
    const insights = await getRecentInsights(env, { limit: 5 });
    if (insights?.length) {
      insightsBlock =
        "[Нещодавні знання]\n" +
        insights.map((i) => `• ${i.insight}`).join("\n");
    }
  } catch {}

  const core = `You are Senti — personal assistant.
- Reply in user's language.
- Be concise by default.`;

  const parts = [core];
  if (statut) parts.push(`[Статут]\n${statut}`);
  if (tune) parts.push(`[Self-tune]\n${tune}`);
  if (insightsBlock) parts.push(insightsBlock);
  if (dlg) parts.push(dlg);
  return parts.join("\n\n");
}

// response text
function asText(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (typeof res.text === "string") return res.text;
  if (Array.isArray(res.choices) && res.choices[0]?.message?.content)
    return res.choices[0].message.content;
  return JSON.stringify(res);
}

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
  if (update.callback_query) {
    const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
    if (token) {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ callback_query_id: update.callback_query.id }),
      });
    }
    return json({ ok: true });
  }

  const msg =
    update.message || update.edited_message || update.channel_post;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const isAdmin = ADMIN(env, userId);
  const textRaw = String(msg?.text || msg?.caption || "").trim();
  const userLang = msg?.from?.language_code || "uk";
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
        await sendPlain(env, chatId, "Сталася помилка, спробуй ще раз.");
      }
    }
  };

  // save location
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, "✅ Локацію збережено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // /start
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

  // drive on/off
  if (textRaw === BTN_DRIVE) {
    await setDriveMode(env, userId, true);
    return json({ ok: true });
  }
  if (textRaw === BTN_SENTI) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);
    return json({ ok: true });
  }

  // /admin
  if (textRaw === "/admin" || textRaw === BTN_ADMIN) {
    await safe(async () => {
      const { checklist, energy, learn } = buildAdminLinks(env, userId);
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
    });
    return json({ ok: true });
  }

  // Codex on/off
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
      "🧠 Senti Codex увімкнено. Надішли задачу (наприклад: «зроби html тетріс»).",
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }
  if (textRaw === "/codex_off") {
    await setCodexMode(env, userId, false);
    await clearCodexMem(env, userId);
    await sendPlain(env, chatId, "Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // media before codex: if drive ON → save, else vision
  try {
    const driveOn = await getDriveMode(env, userId);
    const hasMedia = !!detectAttachment(msg) || !!pickPhoto(msg);

    if (driveOn && hasMedia && !(await getCodexMode(env, userId))) {
      if (await handleIncomingMedia(env, chatId, userId, msg, lang))
        return json({ ok: true });
    }
    if (!driveOn && hasMedia && !(await getCodexMode(env, userId))) {
      if (
        await handleVisionMedia(env, chatId, userId, msg, lang, msg?.caption)
      )
        return json({ ok: true });
    }
  } catch (e) {
    if (isAdmin) {
      await sendPlain(env, chatId, `❌ Media error: ${String(e).slice(0, 180)}`);
    } else {
      await sendPlain(env, chatId, "Не вдалося обробити медіа.");
    }
    return json({ ok: true });
  }

  // codex extra cmds (вже в окремому модулі)
  if (await getCodexMode(env, userId)) {
    if (await handleCodexCommand(env, chatId, userId, textRaw, sendPlain)) {
      return json({ ok: true });
    }
  }

  // date / time / weather
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
          if (!/Не вдалося знайти/.test(byPlace.text)) {
            await sendPlain(env, chatId, byPlace.text, {
              parse_mode: byPlace.mode || undefined,
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
      });
      return json({ ok: true });
    }
  }

  // Codex main (тепер через handler)
  if ((await getCodexMode(env, userId)) && (textRaw || pickPhoto(msg))) {
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
          describeImage,
          sendDocument,
          startPuzzleAnimation,
          editMessageText,
        }
      );
    });
    return json({ ok: true });
  }

  // звичайне повідомлення
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
      const order =
        String(env.MODEL_ORDER || "").trim() ||
        "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";

      const res = await askAnyModel(env, order, textRaw, { systemHint });
      const full = asText(res) || "Не впевнений.";
      await pushTurn(env, userId, "assistant", full);
      await sendPlain(env, chatId, full);
    });
    return json({ ok: true });
  }

  // дефолт
  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });
  return json({ ok: true });
}
