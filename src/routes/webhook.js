// src/routes/webhook.js
import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage, detectFromText } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import { enqueueLearn, listQueued, getRecentInsights } from "../lib/kvLearnQueue.js";
import { dateIntent, timeIntent, replyCurrentDate, replyCurrentTime } from "../apis/time.js";
import { weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords } from "../apis/weather.js";
import { setUserLocation, getUserLocation } from "../lib/geo.js";

const {
  BTN_DRIVE, BTN_SENTI, BTN_ADMIN, BTN_LEARN,
  mainKeyboard, ADMIN, energyLinks, sendPlain, parseAiCommand,
  askLocationKeyboard
} = TG;

// === typing indicator ===
async function sendTyping(env, chatId) {
  try {
    const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
    if (!token || !chatId) return;
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" })
    });
  } catch {}
}
function pulseTyping(env, chatId, times = 4, intervalMs = 4000) {
  sendTyping(env, chatId);
  for (let i = 1; i < times; i++) setTimeout(() => sendTyping(env, chatId), i * intervalMs);
}

// === CF Vision ===
async function cfVisionDescribe(env, imageUrl, userPrompt = "", lang = "uk") {
  if (!env.CLOUDFLARE_API_TOKEN || !env.CF_ACCOUNT_ID) throw new Error("CF credentials missing");
  const model = "@cf/llama-3.2-11b-vision-instruct";
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/${model}`;
  const messages = [{
    role: "user",
    content: [
      { type: "input_text", text: `${userPrompt || "Опиши зображення коротко."} Відповідай ${lang}.` },
      { type: "input_image", image_url: imageUrl }
    ]
  }];
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ messages })
  });
  const data = await r.json().catch(() => null);
  if (!data?.success) throw new Error(data?.errors?.[0]?.message || `CF vision failed (${r.status})`);
  return String(data.result?.response || data.result?.text || "").trim();
}

// === helpers ===
function pickPhoto(msg) {
  const arr = msg?.photo; if (!arr?.length) return null;
  const ph = arr[arr.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  const map = ["document", "video", "audio", "voice", "video_note"];
  for (const k of map) if (msg[k]) {
    const f = msg[k];
    return { type: k, file_id: f.file_id, name: f.file_name || `${k}_${f.file_unique_id}` };
  }
  return pickPhoto(msg);
}
async function tgFileUrl(env, file_id) {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const r = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file_id })
  });
  const data = await r.json().catch(() => null);
  if (!data?.ok) throw new Error("getFile failed");
  return `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
}

// === Drive & Vision ===
async function handleIncomingMedia(env, chatId, userId, msg, lang) {
  const att = detectAttachment(msg);
  if (!att) return false;
  const cur = await getEnergy(env, userId);
  const need = Number(cur.costImage ?? 5);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(lang, "need_energy_media", need, links.energy));
    return true;
  }
  await spendEnergy(env, userId, need, "media");
  const url = await tgFileUrl(env, att.file_id);
  const saved = await driveSaveFromUrl(env, userId, url, att.name);
  await sendPlain(env, chatId, `✅ ${t(lang, "saved_to_drive")}: ${saved?.name || att.name}`, {
    reply_markup: { inline_keyboard: [[{ text: t(lang, "open_drive_btn"), url: "https://drive.google.com/drive/my-drive" }]] }
  });
  return true;
}
async function handleVisionMedia(env, chatId, userId, msg, lang, caption) {
  const att = pickPhoto(msg);
  if (!att) return false;
  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
    return true;
  }
  await spendEnergy(env, userId, need, "vision");
  pulseTyping(env, chatId);
  const url = await tgFileUrl(env, att.file_id);
  try {
    const resp = await cfVisionDescribe(env, url, caption, lang);
    await sendPlain(env, chatId, `🖼️ ${resp}`);
  } catch (e) {
    await sendPlain(env, chatId, `⚠️ Vision error: ${String(e.message || e)}`);
  }
  return true;
}

// === learn queue helper ===
function extractFirstUrl(text = "") {
  const m = String(text).match(/https?:\/\/\S+/i);
  return m ? m[0] : null;
}

// === main webhook ===
export async function handleTelegramWebhook(req, env) {
  if (req.method !== "POST")
    return json({ ok: true, note: "webhook alive" });

  const sec = req.headers.get("x-telegram-bot-api-secret-token");
  const expected = env.TG_WEBHOOK_SECRET || env.WEBHOOK_SECRET;
  if (expected && sec !== expected)
    return json({ ok: false, error: "unauthorized" }, { status: 401 });

  let update;
  try { update = await req.json(); } catch { return json({ ok: false }, { status: 400 }); }

  const msg = update.message || update.edited_message || update.callback_query?.message;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const text = String(msg?.text || msg?.caption || "").trim();
  const isAdmin = ADMIN(env, userId);
  const lang = pickReplyLanguage(msg, text);

  const safe = async fn => { try { await fn(); } catch (e) {
    if (isAdmin) await sendPlain(env, chatId, `❌ ${String(e.message || e)}`);
    else await sendPlain(env, chatId, t(lang, "default_reply"));
  }};

  // location
  if (msg?.location && userId && chatId) {
    await setUserLocation(env, userId, msg.location);
    await sendPlain(env, chatId, t(lang, "loc_saved"), { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  // === ADMIN ===
  if (text === "/admin" || text === BTN_ADMIN) {
    await safe(async () => {
      const mo = env.MODEL_ORDER;
      const hasGemini = !!env.GEMINI_API_KEY;
      const hasCF = !!(env.CLOUDFLARE_API_TOKEN && env.CF_ACCOUNT_ID);
      const hasOR = !!env.OPENROUTER_API_KEY;
      const lines = [
        "🧠 Senti admin",
        `MODEL_ORDER: ${mo}`,
        `Gemini: ${hasGemini ? "✅" : "❌"}, CF: ${hasCF ? "✅" : "❌"}, OpenRouter: ${hasOR ? "✅" : "❌"}`
      ];
      const links = energyLinks(env, userId);
      const kb = [[{ text: "📋 Checklist", url: links.checklist }],
                  [{ text: "🧠 Learn", url: links.learn }]];
      await sendPlain(env, chatId, lines.join("\n"), { reply_markup: { inline_keyboard: kb } });
    });
    return json({ ok: true });
  }

  // === LEARN button ===
  if (text === BTN_LEARN && isAdmin) {
    await safe(async () => {
      const links = energyLinks(env, userId);
      const r = await listQueued(env, { limit: 1 }).catch(() => []);
      const has = r?.length > 0;
      const kb = [[{ text: "🧠 Відкрити Learn HTML", url: links.learn }]];
      if (has) kb.push([{ text: "🚀 Запустити Learn", url: abs(env, `/admin/learn/run?s=${env.WEBHOOK_SECRET}`) }]);
      await sendPlain(env, chatId, "🧠 Режим Learn активний.", { reply_markup: { inline_keyboard: kb } });
    });
    return json({ ok: true });
  }

  // === /ai direct ===
  const aiArg = parseAiCommand(text);
  if (aiArg !== null) {
    await safe(async () => {
      const q = aiArg.trim();
      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
        return;
      }
      await spendEnergy(env, userId, need, "text");
      pulseTyping(env, chatId);
      const systemHint = await buildDialogHint(env, userId);
      const { short } = await think(env, q, { systemHint });
      await pushTurn(env, userId, "user", q);
      await pushTurn(env, userId, "assistant", short);
      await sendPlain(env, chatId, short);
    });
    return json({ ok: true });
  }

  // === Drive / Senti toggles ===
  if (text === BTN_DRIVE) {
    await setDriveMode(env, userId, true);
    const ut = await getUserTokens(env, userId);
    if (!ut?.refresh_token) {
      const authUrl = abs(env, `/auth/start?u=${userId}`);
      await sendPlain(env, chatId, "🔗 Підключи Google Drive", {
        reply_markup: { inline_keyboard: [[{ text: "Authorize", url: authUrl }]] }
      });
    } else {
      await sendPlain(env, chatId, "✅ Drive режим активний.");
    }
    return json({ ok: true });
  }
  if (text === BTN_SENTI) {
    await setDriveMode(env, userId, false);
    await sendPlain(env, chatId, "🤖 Режим Senti активний.", { reply_markup: mainKeyboard(isAdmin) });
    return json({ ok: true });
  }

  // === LEARN enqueue (admin) ===
  if (isAdmin) {
    const u = extractFirstUrl(text);
    const att = detectAttachment(msg);
    if (u || att?.file_id) {
      await safe(async () => {
        const name = att?.name || u;
        const url = att ? await tgFileUrl(env, att.file_id) : u;
        await enqueueLearn(env, userId, { url, name });
        await sendPlain(env, chatId, "✅ Додано в чергу Learn.");
      });
      return json({ ok: true });
    }
  }

  // === MEDIA ===
  try {
    const driveOn = await getDriveMode(env, userId);
    if (driveOn ? await handleIncomingMedia(env, chatId, userId, msg, lang)
                : await handleVisionMedia(env, chatId, userId, msg, lang, msg?.caption))
      return json({ ok: true });
  } catch (e) { await sendPlain(env, chatId, `❌ ${e}`); }

  // === intents (time/date/weather) ===
  if (text) {
    const d = dateIntent(text), tm = timeIntent(text), w = weatherIntent(text);
    if (d || tm || w) {
      await safe(async () => {
        if (d) await sendPlain(env, chatId, replyCurrentDate(env, lang));
        if (tm) await sendPlain(env, chatId, replyCurrentTime(env, lang));
        if (w) {
          const byPlace = await weatherSummaryByPlace(env, text, lang);
          if (!/Не вдалося знайти/.test(byPlace.text))
            await sendPlain(env, chatId, byPlace.text, { parse_mode: byPlace.mode });
          else {
            const geo = await getUserLocation(env, userId);
            if (geo?.lat) {
              const byCoords = await weatherSummaryByCoords(geo.lat, geo.lon, lang);
              await sendPlain(env, chatId, byCoords.text);
            } else {
              await sendPlain(env, chatId, t(lang, "ask_location"), { reply_markup: askLocationKeyboard() });
            }
          }
        }
      });
      return json({ ok: true });
    }
  }

  // === default AI ===
  if (text && !text.startsWith("/")) {
    await safe(async () => {
      const cur = await getEnergy(env, userId);
      const need = Number(cur.costText ?? 1);
      if ((cur.energy ?? 0) < need) {
        const links = energyLinks(env, userId);
        await sendPlain(env, chatId, t(lang, "need_energy_text", need, links.energy));
        return;
      }
      await spendEnergy(env, userId, need, "text");
      pulseTyping(env, chatId);
      const hint = await buildDialogHint(env, userId);
      const { short } = await think(env, text, { systemHint: hint });
      await pushTurn(env, userId, "user", text);
      await pushTurn(env, userId, "assistant", short);
      await sendPlain(env, chatId, short);
    });
    return json({ ok: true });
  }

  await sendPlain(env, chatId, "👋 Привіт! Я Senti.", { reply_markup: mainKeyboard(isAdmin) });
  return json({ ok: true });
}
