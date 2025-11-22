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

const {
  BTN_DRIVE,
  BTN_SENTI,
  BTN_ADMIN,
  BTN_CODEX,
  mainKeyboard,
  ADMIN,
  energyLinks,
  askLocationKeyboard,
} = TG;

const KV = {
  learnMode: (uid) => `learn:mode:${uid}`,
  codexMode: (uid) => `codex:mode:${uid}`,
};

const VISION_MEM_KEY = (uid) => `vision:mem:${uid}`;
const CODEX_MEM_KEY = (uid) => `codex:mem:${uid}`;

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

// ---- codex project memory
async function loadCodexMem(env, userId) {
  try {
    const raw = await (env.STATE_KV || env.CHECKLIST_KV)?.get(
      CODEX_MEM_KEY(userId),
      "text"
    );
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
async function saveCodexMem(env, userId, entry) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  try {
    const arr = await loadCodexMem(env, userId);
    arr.push({
      filename: entry.filename,
      content: entry.content,
      ts: Date.now(),
    });
    await kv.put(CODEX_MEM_KEY(userId), JSON.stringify(arr), {
      expirationTtl: 60 * 60 * 24 * 180,
    });
  } catch {}
}
async function clearCodexMem(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  try {
    await kv.delete(CODEX_MEM_KEY(userId));
  } catch {}
}

async function sendPlain(env, chatId, text, extra = {}) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) return;
  const body = {
    chat_id: chatId,
    text,
    ...extra,
  };
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function sendTyping(env, chatId) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      action: "typing",
    }),
  });
}
function pulseTyping(env, chatId, times = 3, intervalMs = 4000) {
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
  const buf = await r.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function pickPhoto(msg) {
  const photos = msg?.photo;
  if (!photos || !photos.length) return null;
  const arr = [...photos].sort(
    (a, b) => (a.file_size || 0) - (b.file_size || 0)
  );
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
  if (msg.photo) {
    return pickPhoto(msg);
  }
  if (msg.video) {
    const v = msg.video;
    return {
      type: "video",
      file_id: v.file_id,
      name: `video_${v.file_unique_id}.mp4`,
    };
  }
  return null;
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
            [{ text: "🔗 Підключити Drive", url: connectUrl }],
          ],
        },
      }
    );
    return true;
  }

  const cur = await getEnergy(env, userId);
  const need = Number(cur.costMedia ?? 2);
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

// vision follow-up: текстові питання про останнє фото
async function handleVisionFollowup(env, chatId, userId, textRaw, lang) {
  const q = String(textRaw || "").trim();
  if (!q) return false;

  const mem = await loadVisionMem(env, userId);
  if (!mem || !mem.length) return false;
  const last = mem[0] || {};

  const now = Date.now();
  const recentEnough = last.ts && now - last.ts < 3 * 60 * 1000; // ~3 хвилини

  const lower = q.toLowerCase();
  const refersToImage =
    lower.includes("на фото") ||
    lower.includes("на зображенні") ||
    lower.includes("на картинці") ||
    lower.includes("на скріншоті") ||
    lower.includes("на цьому фото") ||
    lower.startsWith("це ") ||
    lower.startsWith("це?") ||
    lower.includes("це де") ||
    lower.includes("де це");

  if (!recentEnough && !refersToImage) return false;

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
  await spendEnergy(env, userId, need, "vision_followup");
  pulseTyping(env, chatId);

  if (!last.url) return false;

  let imageBase64;
  try {
    imageBase64 = await urlToBase64(last.url);
  } catch (e) {
    if (ADMIN(env, userId)) {
      await sendPlain(
        env,
        chatId,
        `❌ Vision follow-up error: ${String(e.message || e).slice(0, 180)}`
      );
    }
    return false;
  }

  const visionOrder =
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";

  try {
    const { text } = await describeImage(env, {
      chatId,
      tgLang: lang,
      imageBase64,
      question: q,
      modelOrder: visionOrder,
    });

    await saveVisionMem(env, userId, {
      id: last.id,
      url: last.url,
      caption: last.caption,
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
    return true;
  } catch (e) {
    if (ADMIN(env, userId)) {
      await sendPlain(
        env,
        chatId,
        `❌ Vision follow-up error: ${String(e.message || e).slice(0, 180)}`
      );
    } else {
      await sendPlain(
        env,
        chatId,
        "Поки що не можу проаналізувати фото ще раз."
      );
    }
    return true;
  }
}

// system hint
async function buildSystemHint(env, chatId, userId, preferredLang) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId, { preferredLang }).catch(
    () => ""
  );

  let insightsBlock = "";
  try {
    const { getRecentInsights } = await import("../lib/kvLearnQueue.js");
    const insights = await getRecentInsights(env, userId, 5);
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

// codex mode state
async function setCodexMode(env, userId, on) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(KV.codexMode(userId), on ? "on" : "off", {
    expirationTtl: 60 * 60 * 24 * 180,
  });
}
async function getCodexMode(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return false;
  const val = await kv.get(KV.codexMode(userId), "text");
  return val === "on";
}
// learn mode state
async function setLearnMode(env, userId, on) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return;
  await kv.put(KV.learnMode(userId), on ? "on" : "off", {
    expirationTtl: 60 * 60 * 24 * 180,
  });
}
async function getLearnMode(env, userId) {
  const kv = env.STATE_KV || env.CHECKLIST_KV;
  if (!kv) return false;
  const val = await kv.get(KV.learnMode(userId), "text");
  return val === "on";
}

// codex filename by language
function guessCodexFilename(lang) {
  const l = (lang || "").toLowerCase();
  if (l.startsWith("uk")) return "codex-uk.txt";
  if (l.startsWith("en")) return "codex-en.txt";
  if (l.startsWith("de")) return "codex-de.txt";
  if (l === "js" || l === "javascript") return "codex.js";
  if (l === "ts" || l === "typescript") return "codex.ts";
  if (l === "html") return "codex.html";
  if (l === "css") return "codex.css";
  if (l === "json") return "codex.json";
  if (l === "py" || l === "python") return "codex.py";
  return "codex.txt";
}

function asText(res) {
  if (!res) return "";
  if (typeof res === "string") return res;
  if (Array.isArray(res?.choices)) {
    const c = res.choices[0];
    if (!c) return "";
    const content = c.message?.content || c.text || "";
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const t = content
        .filter((p) => p.type === "text" && p.text?.length)
        .map((p) => p.text)
        .join("\n");
      return t;
    }
  }
  if (res.output_text) return res.output_text;
  if (res.text) return res.text;
  if (res.message) return res.message;
  return "";
}

async function handleTelegramWebhook(req, env) {
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

  // /start
  if (textRaw === "/start") {
    await safe(async () => {
      await setDriveMode(env, userId, false);
      await setCodexMode(env, userId, false);
      await setLearnMode(env, userId, true);
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
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "Режим Drive: увімкнений.");
    return json({ ok: true });
  }
  if (textRaw === BTN_SENTI) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);
    await sendPlain(env, chatId, "Повертаємось у звичайний режим Senti.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // learn on/off
  if (textRaw === "/learn_on") {
    await setLearnMode(env, userId, true);
    await sendPlain(env, chatId, "Режим Learn увімкнено.");
    return json({ ok: true });
  }
  if (textRaw === "/learn_off") {
    await setLearnMode(env, userId, false);
    await sendPlain(env, chatId, "Режим Learn вимкнено.");
    return json({ ok: true });
  }

  // admin panel
  if (textRaw === BTN_ADMIN || textRaw === "/admin") {
    if (!isAdmin) {
      await sendPlain(env, chatId, "🛡️ Admin тільки для власника бота.");
      return json({ ok: true });
    }
    await safe(async () => {
      const checklist = abs(env, "/admin/checklist");
      const energy = abs(env, "/admin/energy");
      const learn = abs(env, "/admin/learn");
      const brain = abs(env, "/admin/brain");
      const usage = abs(env, "/admin/usage");
      const body =
        "Admin panel (quick diagnostics):\n" +
        `MODEL_ORDER: ${env.MODEL_ORDER || "(default)"}\n` +
        `GEMINI key: ${env.GEMINI_API_KEY || env.GOOGLE_API_KEY ? "✅" : "❌"}\n` +
        `Cloudflare: ${env.CF_ACCOUNT_ID && env.CF_API_TOKEN ? "✅" : "❌"}\n` +
        `OpenRouter: ${env.OPENROUTER_API_KEY ? "✅" : "❌"}\n` +
        `FreeLLM: ${
          env.FREE_API_BASE_URL && env.FREE_API_KEY ? "✅" : "❌"
        }`;
      await sendPlain(env, chatId, body, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🧠 Brain", url: brain }],
            [{ text: "📋 Checklist", url: checklist }],
            [{ text: "⚡ Energy", url: energy }],
            [{ text: "🧠 Learn", url: learn }],
            [{ text: "💾 Usage", url: usage }],
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

  // vision follow-up: текстові питання про останнє фото (коли Codex вимкнено)
  if (textRaw && !(await getCodexMode(env, userId))) {
    const handledFollowup = await handleVisionFollowup(
      env,
      chatId,
      userId,
      textRaw,
      lang
    );
    if (handledFollowup) {
      return json({ ok: true });
    }
  }

  // codex extra cmds
  if (await getCodexMode(env, userId)) {
    if (textRaw === "/clear_last") {
      await safe(async () => {
        const arr = await loadCodexMem(env, userId);
        if (!arr.length) {
          await sendPlain(env, chatId, "Немає файлів для видалення.");
        } else {
          arr.pop();
          const kv = env.STATE_KV || env.CHECKLIST_KV;
          if (kv) await kv.put(CODEX_MEM_KEY(userId), JSON.stringify(arr));
          await sendPlain(env, chatId, "Останній файл прибрано.");
        }
      });
      return json({ ok: true });
    }
    if (textRaw === "/clear_all") {
      await safe(async () => {
        await clearCodexMem(env, userId);
        await sendPlain(env, chatId, "Весь проєкт очищено.");
      });
      return json({ ok: true });
    }
    if (textRaw === "/summary") {
      await safe(async () => {
        const arr = await loadCodexMem(env, userId);
        if (!arr.length) {
          await sendPlain(env, chatId, "У проєкті поки що порожньо.");
        } else {
          const lines = arr.map((f) => `- ${f.filename}`).join("\n");
          await sendPlain(env, chatId, `Файли:\n${lines}`);
        }
      });
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
          const placeMatch = textRaw.match(/в\s+(.+)/i);
          if (placeMatch && placeMatch[1]) {
            const place = placeMatch[1].trim();
            const { text } = await weatherSummaryByPlace(env, place, lang);
            await sendPlain(env, chatId, text);
          } else {
            const loc = await getUserLocation(env, userId);
            if (loc) {
              const { text } = await weatherSummaryByCoords(env, loc, lang);
              await sendPlain(env, chatId, text);
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

  // Codex main: generate file (тут і анімація, і фото → в код)
  if ((await getCodexMode(env, userId)) && (textRaw || pickPhoto(msg))) {
    await safe(async () => {
      const prompt = textRaw || "";
      const photo = pickPhoto(msg);
      const systemHint = await buildSystemHint(env, chatId, userId, lang);

      let input = prompt;
      if (photo) {
        const url = await tgFileUrl(env, photo.file_id);
        const base64 = await urlToBase64(url);
        const visionOrder =
          "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";

        const { text } = await describeImage(env, {
          chatId,
          tgLang: msg.from?.language_code,
          imageBase64: base64,
          question:
            prompt ||
            (lang.startsWith("uk")
              ? "Опиши, що на фото, для подальшої роботи з кодом."
              : "Describe the image for further coding."),
          modelOrder: visionOrder,
        });

        input =
          prompt +
          "\n\n[Image analysis]\n" +
          text +
          "\n\nСгенеруй або онови потрібний код за цим описом.";
      }

      const status = await sendPlain(env, chatId, "🧩 Працюю над Codex…");
      const messageId = status?.result?.message_id;
      const signal = { done: false };
      if (messageId) startPuzzleAnimation(env, chatId, messageId, signal);

      const system =
        systemHint +
        "\n\nТи працюєш як Senti Codex (Architect): твоя задача — створювати або оновлювати файли проєкту. Виводь тільки код або інструкції без зайвого тексту.";
      const order =
        env.CODEX_MODEL_ORDER ||
        env.MODEL_ORDER ||
        "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct";

      const res = await askAnyModel(env, order, input, { systemHint: system });
      const full = asText(res) || "Не впевнений.";

      signal.done = true;

      const filename = guessCodexFilename("txt");
      await saveCodexMem(env, userId, {
        filename,
        content: full,
      });

      await sendPlain(env, chatId, "Готово! Відправляю результат файлом.");
      await sendDocument(env, chatId, filename, full, "Senti Codex result");
    });
    return json({ ok: true });
  }

  // GPS location
  if (msg?.location) {
    await safe(async () => {
      await setUserLocation(env, userId, msg.location);
      const { text } = await weatherSummaryByCoords(env, msg.location, lang);
      await sendPlain(env, chatId, text);
    });
    return json({ ok: true });
  }

  // common ai respond
  if (textRaw) {
    await safe(async () => {
      const systemHint = await buildSystemHint(env, chatId, userId, lang);
      const modelOrder =
        env.MODEL_ORDER ||
        "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";

      const { aiRespond } = await import("../flows/aiRespond.js");
      const out = await aiRespond(env, {
        text: textRaw,
        lang,
        name: msg?.from?.first_name || "friend",
        systemHint,
        expand: false,
      });

      await pushTurn(env, userId, "assistant", out);
      await sendPlain(env, chatId, out);
    });
    return json({ ok: true });
  }

// дефолт
  await sendPlain(env, chatId, "Привіт! Що зробимо?", {
    reply_markup: mainKeyboard(isAdmin),
  });
  return json({ ok: true });
}

export { handleTelegramWebhook };