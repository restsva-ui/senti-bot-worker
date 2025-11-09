// src/routes/webhook.js
// стабільний варіант: admin-кнопки одразу з URL, Codex шле тільки файл, є індикатор

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
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

const KV = {
  learnMode: (uid) => `learn:mode:${uid}`,
  codexMode: (uid) => `codex:mode:${uid}`,
};

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

// sendDocument — щоб Codex давав файл
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

// editMessageText — щоб анімувати «пазл»
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

// base64 з TG (для vision)
async function urlToBase64(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ab = await r.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
// ── media helpers ──
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

// ===== learn helpers =====
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
async function runLearnNow(env) {
  const secret =
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    "";
  const u = new URL(abs(env, "/admin/learn/run"));
  if (secret) u.searchParams.set("s", secret);
  const r = await fetch(u.toString(), { method: "POST" });
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) throw new Error(`learn_run http ${r.status}`);
  if (ct.includes("application/json")) return await r.json();
  return { ok: true, summary: await r.text() };
}

// ===== drive-mode =====
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

// ===== vision-mode =====
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
    if (landmarks && landmarks.length) {
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
      const connectUrl = abs(env, "/auth/drive");
      await sendPlain(
        env,
        chatId,
        "Поки що не можу аналізувати фото. Можу зберегти його у Google Drive — натисни «Google Drive» або підключи Drive.",
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
    }
  }
  return true;
}
// ===== Codex helpers =====
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
function asText(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (typeof x.text === "string") return x.text;
  if (Array.isArray(x?.choices) && x.choices[0]?.message?.content)
    return String(x.choices[0].message.content);
  if (typeof x.content === "string") return x.content;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

// витягнути код і мову
function extractCodeAndLang(text) {
  const m = text.match(/```(\w+)?([\s\S]*?)```/);
  if (m) {
    const lang = (m[1] || "").trim().toLowerCase();
    const code = m[2].trim();
    return { lang, code };
  }
  // може бути просто html без ``` 
  if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
    return { lang: "html", code: text.trim() };
  }
  return { lang: "", code: text.trim() };
}
function pickFilenameByLang(lang) {
  if (lang === "html") return "codex.html";
  if (lang === "javascript" || lang === "js") return "codex.js";
  if (lang === "typescript" || lang === "ts") return "codex.ts";
  if (lang === "python" || lang === "py") return "codex.py";
  if (lang === "css") return "codex.css";
  if (lang === "json") return "codex.json";
  return "codex.txt";
}
async function runCodex(env, prompt) {
  const system =
    "Ти — Senti Codex. Даєш ПОВНИЙ код, без пропусків, без '...'. Якщо це HTML — повний HTML документ.";
  const order =
    String(env.CODEX_MODEL_ORDER || env.MODEL_ORDER || "").trim() ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct";
  const res = await askAnyModel(env, order, prompt, { systemHint: system });
  return asText(res);
}

// ===== SystemHint =====
async function buildSystemHint(env, chatId, userId, preferredLang) {
  const statut = String((await readStatut(env)) || "").trim();
  const dlg = await buildDialogHint(env, userId);
  const tune = await loadSelfTune(env, chatId, { preferredLang }).catch(
    () => null
  );

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

// ===== smart text LLM =====
async function callSmartLLM(env, userText, opts = {}) {
  const order =
    String(env.MODEL_ORDER || "").trim() ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-instruct, free:meta-llama/llama-4-scout:free";

  const sys =
    (opts.systemHint || "") +
    "\n\n[Style]\nKeep answers short and practical by default. Expand only when user says so.";

  const res = await askAnyModel(env, order, userText, { systemHint: sys });
  const full = asText(res) || "Не впевнений.";
  const short =
    opts.expand || full.length <= 900 ? full : full.slice(0, 900) + "…";
  return { full, short };
}
export async function handleTelegramWebhook(req, env) {
  // ВАЖЛИВО: GET тепер завжди ок
  if (req.method === "GET") {
    return json({ ok: true, worker: "senti", ts: Date.now() });
  }

  // POST: можемо перевірити секрет, але м’яко
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

  let update;
  try {
    update = await req.json();
  } catch {
    return json({ ok: false }, 400);
  }

  // ми прибрали callback_query для admin-кнопок — усе віддамо одразу через URL
  if (update.callback_query) {
    // залишимо тільки answerCallbackQuery, щоб не висіло
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
        await sendPlain(env, chatId, t(lang, "default_reply"));
      }
    }
  };

  // локація
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(
      env,
      chatId,
      "✅ Локацію збережено.",
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }

  // /start
  if (textRaw === "/start") {
    await safe(async () => {
      await setCodexMode(env, userId, false);
      const name = msg?.from?.first_name || "друже";
      await sendPlain(
        env,
        chatId,
        `${t(lang, "hello_name", name)} ${t(lang, "how_help")}`,
        { reply_markup: mainKeyboard(isAdmin) }
      );
    });
    return json({ ok: true });
  }

  // прості перемикачі
  if (textRaw === BTN_DRIVE || /^(google\s*drive)$/i.test(textRaw)) {
    await setDriveMode(env, userId, true);
    return json({ ok: true });
  }
  if (textRaw === BTN_SENTI || /^(senti|сенті)$/i.test(textRaw)) {
    await setDriveMode(env, userId, false);
    await setCodexMode(env, userId, false);
    return json({ ok: true });
  }

  // /admin — одразу даємо URL-кнопки
  if (textRaw === "/admin" || textRaw === BTN_ADMIN) {
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
      const links = energyLinks(env, userId);

      const lines = [
        t(lang, "admin_header"),
        `MODEL_ORDER: ${mo || "(not set)"}`,
        `GEMINI key: ${hasGemini ? "✅" : "❌"}`,
        `Cloudflare: ${hasCF ? "✅" : "❌"}`,
        `OpenRouter: ${hasOR ? "✅" : "❌"}`,
        `FreeLLM: ${hasFreeBase && hasFreeKey ? "✅" : "❌"}`,
      ];

      const inline_keyboard = [];
      if (links.checklist)
        inline_keyboard.push([{ text: "📋 Checklist", url: links.checklist }]);
      if (links.energy)
        inline_keyboard.push([{ text: "⚡ Energy", url: links.energy }]);
      if (links.learn)
        inline_keyboard.push([{ text: "🧠 Learn", url: links.learn }]);

      await sendPlain(env, chatId, lines.join("\n"), {
        reply_markup: { inline_keyboard },
      });
    });
    return json({ ok: true });
  }

  // Codex on/off
  if (textRaw === BTN_CODEX || textRaw === "/codex") {
    if (!isAdmin) {
      await sendPlain(env, chatId, "🛡️ Codex доступний лише адміну.");
      return json({ ok: true });
    }
    await setCodexMode(env, userId, true);
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
    await sendPlain(env, chatId, "Codex вимкнено.", {
      reply_markup: mainKeyboard(isAdmin),
    });
    return json({ ok: true });
  }

  // media routing (drive / vision)
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
  } catch (e) {
    if (isAdmin) {
      await sendPlain(env, chatId, `❌ Media error: ${String(e).slice(0, 180)}`);
    } else {
      await sendPlain(env, chatId, t(lang, "default_reply"));
    }
    return json({ ok: true });
  }

  // інтенти (дата/час/погода)
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

  // Codex обробка — тільки файл
  if ((await getCodexMode(env, userId)) && textRaw) {
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

      // індикатор
      const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
      let indicatorId = null;
      if (token) {
        const r = await fetch(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: "🧩 Працюю над кодом…",
            }),
          }
        );
        const d = await r.json().catch(() => null);
        indicatorId = d?.result?.message_id || null;
      }

      await spendEnergy(env, userId, need, "codex");
      pulseTyping(env, chatId);

      const ans = await runCodex(env, textRaw);
      await pushTurn(env, userId, "user", textRaw);
      await pushTurn(env, userId, "assistant", ans);

      const { lang: codeLang, code } = extractCodeAndLang(ans);
      const fname = pickFilenameByLang(codeLang);
      await sendDocument(env, chatId, fname, code, "Ось готовий файл 👇");

      // оновлюємо індикатор
      await editMessageText(env, chatId, indicatorId, "✅ Готово");

      // все, без довгого коду в чат
    });
    return json({ ok: true });
  }

  // звичайний текст — як і раніше
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
      const expand = /\b(детальн|подроб|more|details)\b/i.test(textRaw);
      const { short, full } = await callSmartLLM(env, textRaw, {
        lang,
        systemHint,
        expand,
        adminDiag: isAdmin,
      });

      await pushTurn(env, userId, "assistant", full);
      if (expand && full.length > short.length) {
        // якщо просили детально — можна й шматками
        const parts = [];
        for (let i = 0; i < full.length; i += 3800)
          parts.push(full.slice(i, i + 3800));
        for (const p of parts) await sendPlain(env, chatId, p);
      } else {
        await sendPlain(env, chatId, short);
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