// src/routes/webhook.js
// Telegram webhook: дата/час, погода (місто або геолокація), Learn-черга.

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { askAnyModel } from "../lib/modelRouter.js";
import { json, withTimeout } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { t, pickReplyLanguage } from "../lib/i18n.js";
import { sendPlain, mainKeyboard, ADMIN, BTN_LEARN } from "../lib/tg.js";
import {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
} from "../apis/weather.js";
import {
  replyCurrentDate,
  replyCurrentTime,
  dateIntent,
  timeIntent,
} from "../apis/time.js";

// KV binding (має бути в wrangler.toml як LEARN_QUEUE_KV)
const LEARN_QUEUE_KV = globalThis.LEARN_QUEUE_KV;

// ——— утиліти ————————————————————————————————————————
function extractFirstUrl(text = "") {
  const m = String(text).match(/https?:\/\/[^\s)]+/i);
  return m ? m[0] : null;
}

async function queueLearnItem(userId, sourceText) {
  const url = extractFirstUrl(sourceText);
  if (!url) return false;
  const ts = Date.now();
  const key = `learn:queue:${userId}:${ts}`;
  const value = JSON.stringify({ userId, url, note: sourceText.slice(0, 2000), ts });
  await LEARN_QUEUE_KV.put(key, value);
  return true;
}

function pickPhoto(msg) {
  const arr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!arr?.length) return null;
  const ph = arr[arr.length - 1];
  return { type: "photo", file_id: ph.file_id, name: `photo_${ph.file_unique_id}.jpg` };
}
function detectAttachment(msg) {
  if (!msg) return null;
  if (msg.document) {
    const d = msg.document;
    return { type: "document", file_id: d.file_id, name: d.file_name || `doc_${d.file_unique_id}` };
  }
  if (msg.photo) return pickPhoto(msg);
  if (msg.audio) return { type: "audio", file_id: msg.audio.file_id, name: msg.audio.file_name || "audio" };
  if (msg.voice) return { type: "voice", file_id: msg.voice.file_id, name: "voice.ogg" };
  if (msg.video) return { type: "video", file_id: msg.video.file_id, name: "video.mp4" };
  return null;
}

// ——— основний обробник ——————————————————————————————————
async function webhookImpl(env, req) {
  const update = await req.json().catch(() => ({}));
  const msg = update?.message || update?.edited_message || null;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  if (!chatId || !userId) return json({ ok: true });

  const isAdmin = ADMIN(env, userId);
  const lang = pickReplyLanguage(msg?.from?.language_code);
  const text = String(msg?.text || "").trim();

  // Learn кнопка
  if (text === BTN_LEARN) {
    await sendPlain(
      env,
      chatId,
      "Надішли посилання або повідомлення з посиланнями — додам у чергу самонавчання.",
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }
  // URL → у чергу (адміну)
  if (text && isAdmin && /https?:\/\//i.test(text)) {
    const ok = await queueLearnItem(userId, text);
    await sendPlain(env, chatId, ok ? "✅ Додав у чергу Learn." : "⚠️ Не знайшов коректного посилання.");
    return json({ ok: true });
  }

  // Геолокація → погода
  if (msg?.location) {
    const { latitude, longitude } = msg.location;
    try {
      const out = await withTimeout(weatherSummaryByCoords(latitude, longitude, lang), 8000);
      await sendPlain(env, chatId, out.text, { parse_mode: "Markdown" }); // стрілка ↗︎ клікабельна
    } catch {
      await sendPlain(env, chatId, "Не вдалося отримати погоду за локацією.");
    }
    return json({ ok: true });
  }

  if (text) {
    // Дата / час
    if (dateIntent(text)) {
      await sendPlain(env, chatId, replyCurrentDate(env, lang));
      return json({ ok: true });
    }
    if (timeIntent(text)) {
      await sendPlain(env, chatId, replyCurrentTime(env, lang));
      return json({ ok: true });
    }

    // Погода з фрази
    if (weatherIntent(text)) {
      try {
        const out = await withTimeout(weatherSummaryByPlace(env, text, lang), 8000);
        await sendPlain(env, chatId, out.text, { parse_mode: "Markdown" });
      } catch {
        await sendPlain(env, chatId, "Не вдалося отримати прогноз погоди.");
      }
      return json({ ok: true });
    }
  }

  // Файли/медіа → Google Drive
  const att = detectAttachment(msg);
  if (att) {
    const tokens = await getUserTokens(env, userId).catch(() => null);
    if (!tokens?.access_token) {
      await sendPlain(env, chatId, "Спочатку підключи Google Drive в меню Senti.");
      return json({ ok: true });
    }
    try {
      await driveSaveFromUrl(env, tokens, att.file_id, att.name);
      await sendPlain(env, chatId, "✅ Збережено у Google Drive.");
    } catch {
      await sendPlain(env, chatId, "⚠️ Не вдалося зберегти у Google Drive.");
    }
    return json({ ok: true });
  }

  // Енергія
  const energy = await getEnergy(env, userId).catch(() => ({ left: 100 }));
  if (energy.left <= 0) {
    await sendPlain(env, chatId, "Енергія вичерпана. Спробуй пізніше.");
    return json({ ok: true });
  }

  // Якщо нічого не збіглося → AI або підказка
  if (!text) {
    await sendPlain(
      env,
      chatId,
      `${t(lang, "hello_name", "друже")} ${t(lang, "how_help")}`,
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }

  try {
    const hint = await buildDialogHint(env, userId);
    const answer = await askAnyModel(env, { prompt: text, hint, lang });
    await pushTurn(env, userId, { q: text, a: answer });
    await spendEnergy(env, userId, 1).catch(() => {});
    await sendPlain(env, chatId, answer); // без Markdown — щоб не ламався текст моделі
  } catch {
    await sendPlain(env, chatId, "⚠️ Щось пішло не так. Спробуй ще раз.");
  }
  return json({ ok: true });
}

// ——— Експорти —————————————————————————————————————————————
// named export (саме його імпортує src/index.js)
export async function handleTelegramWebhook(req, env) {
  return webhookImpl(env, req);
}
// default — на випадок прямого імпорту за замовчуванням
export default async function webhook(env, req) {
  return webhookImpl(env, req);
}
