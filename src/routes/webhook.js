// src/routes/webhook.js

import { driveSaveFromUrl } from "../lib/drive.js";
import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { think } from "../lib/brain.js";
import { readStatut } from "../lib/kvChecklist.js";
import { askAnyModel, getAiHealthSummary } from "../lib/modelRouter.js";
import { json, withTimeout } from "../lib/utils.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { buildDialogHint, pushTurn } from "../lib/dialogMemory.js";
import { loadSelfTune } from "../lib/selfTune.js";
import { setDriveMode, getDriveMode } from "../lib/driveMode.js";
import { t, pickReplyLanguage, detectFromText } from "../lib/i18n.js";
import { TG, sendPlain, mainKeyboard, ADMIN, BTN_LEARN } from "../lib/tg.js";
import { weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords } from "../apis/weather.js";
import { replyCurrentDate, replyCurrentTime, dateIntent, timeIntent, resolveTz } from "../apis/time.js";

// KV bindings
const LEARN_QUEUE_KV = globalThis.LEARN_QUEUE_KV; // має бути прив'язаний у wrangler.toml

// ——— допоміжні ————————————————————————————————————————————
const MD = {
  esc(s = "") {
    // екрануємо Markdown V2 «проблемні» символи, але ↗︎ та URL не чіпаємо
    return String(s).replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
  }
};

function extractFirstUrl(text = "") {
  const m = String(text).match(/https?:\/\/[^\s)]+/i);
  return m ? m[0] : null;
}

async function queueLearnItem(env, userId, sourceText) {
  const url = extractFirstUrl(sourceText);
  if (!url) return false;
  const ts = Date.now();
  const key = `learn:queue:${userId}:${ts}`;
  const value = JSON.stringify({
    userId,
    url,
    note: sourceText.slice(0, 2000),
    ts,
  });
  await LEARN_QUEUE_KV.put(key, value);
  return true;
}

// ── Media helpers ───────────────────────────────────────────────────────────
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
// ——— основний хендлер Telegram update —————————————————————
export default async function webhook(env, req) {
  const update = await req.json().catch(() => ({}));
  const msg = update?.message || update?.edited_message || null;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  if (!chatId || !userId) return json({ ok: true });

  const isAdmin = ADMIN(env, userId);
  const lang = pickReplyLanguage(msg?.from?.language_code);

  // Кнопка Learn у клавіатурі (для адміна)
  if (msg?.text && msg.text.trim() === BTN_LEARN) {
    await sendPlain(env, chatId,
      "Надішли посилання або повідомлення з посиланнями, які треба додати у чергу самонавчання.",
      { reply_markup: mainKeyboard(isAdmin) }
    );
    return json({ ok: true });
  }

  // Якщо від користувача прийшов текст, що містить URL → кладемо в чергу (якщо натискали Learn або просто дозволяємо завжди адміну)
  if (msg?.text && isAdmin && /https?:\/\//i.test(msg.text)) {
    const ok = await queueLearnItem(env, userId, msg.text);
    await sendPlain(env, chatId, ok ? "✅ Додав у чергу Learn." : "⚠️ Не знайшов коректного посилання.");
    return json({ ok: true });
  }

  // Обробка локації з Telegram
  if (msg?.location) {
    const { latitude, longitude } = msg.location;
    try {
      const out = await withTimeout(
        weatherSummaryByCoords(latitude, longitude, lang),
        8000
      );
      // важливо вказати Markdown, інакше ↗︎ не буде клікабельною
      await sendPlain(env, chatId, out.text, { parse_mode: "Markdown" });
    } catch {
      await sendPlain(env, chatId, "Не вдалося отримати погоду за локацією.");
    }
    return json({ ok: true });
  }

  // Текстові інтенти
  const text = String(msg?.text || "").trim();

  if (text) {
    // Дата/час
    if (dateIntent(text)) {
      const reply = replyCurrentDate(env, lang);
      await sendPlain(env, chatId, reply);
      return json({ ok: true });
    }
    if (timeIntent(text)) {
      const reply = replyCurrentTime(env, lang);
      await sendPlain(env, chatId, reply);
      return json({ ok: true });
    }

    // Погода
    if (weatherIntent(text)) {
      try {
        const out = await withTimeout(
          weatherSummaryByPlace(env, text, lang),
          8000
        );
        await sendPlain(env, chatId, out.text, { parse_mode: "Markdown" });
      } catch (e) {
        await sendPlain(env, chatId, "Не вдалося отримати прогноз погоди.");
      }
      return json({ ok: true });
    }
  }

  // Файли/медіа → збереження у Drive (як і було)
  const att = detectAttachment(msg);
  if (att) {
    const tokens = await getUserTokens(env, userId).catch(() => null);
    if (!tokens?.access_token) {
      await sendPlain(env, chatId, "Перш ніж зберігати у Drive, треба підключити Google Drive в меню Senti.");
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
// Енергетика та дефолтні відповіді (коротко, без змін твоєї логіки)
  const energy = await getEnergy(env, userId).catch(() => ({ left: 100 }));
  if (energy.left <= 0) {
    await sendPlain(env, chatId, "Енергія вичерпана. Спробуй пізніше.");
    return json({ ok: true });
  }

  // Якщо не розпізнали наміри — просте вітання/допомога
  if (!text) {
    const greetLang = lang;
    await sendPlain(env, chatId, `${t(greetLang, "hello_name", "друже")} ${t(greetLang, "how_help")}`, {
      reply_markup: mainKeyboard(isAdmin)
    });
    return json({ ok: true });
  }

  // Інакше — передаємо в AI (як було), але з екрануванням Markdown у разі потреби:
  try {
    const hint = await buildDialogHint(env, userId);
    const answer = await askAnyModel(env, { prompt: text, hint, lang });
    await pushTurn(env, userId, { q: text, a: answer });
    await spendEnergy(env, userId, 1).catch(() => {});
    // За замовчуванням без Markdown, бо відповідь моделі може містити спецсимволи
    await sendPlain(env, chatId, answer);
  } catch {
    await sendPlain(env, chatId, "⚠️ Щось пішло не так. Спробуй ще раз.");
  }
  return json({ ok: true });
}