// src/routes/webhook.js
import { json } from "../utils/http.js";
import {
  TG,
  BTN_DRIVE,
  BTN_SENTI,
  BTN_LEARN,
  BTN_ADMIN,
  mainKeyboard,
  ADMIN,
  sendPlain,
  energyLinks, // щоб не тягнути двічі
} from "../lib/tg.js";
import { pickLang, t } from "../lib/i18n.js";
import { enqueueLearn } from "../lib/kvLearnQueue.js";

// ————— helpers —————
function getLangFromUpdate(update) {
  // Визначаємо бажану мову з Telegram-профілю користувача.
  // Якщо її немає — fallback на en, далі i18n сам дасть текст потрібною мовою.
  return pickLang(
    update?.message?.from?.language_code ||
      update?.callback_query?.from?.language_code ||
      "en"
  );
}

function getName(update) {
  return (
    update?.message?.from?.first_name ||
    update?.callback_query?.from?.first_name ||
    ""
  );
}

// ————— main handler —————
export async function handleTelegramWebhook(req, env) {
  const update = await req.json().catch(() => ({}));

  const chatId =
    update?.message?.chat?.id ??
    update?.callback_query?.message?.chat?.id ??
    null;
  if (!chatId) return json({ ok: true });

  const userId =
    update?.message?.from?.id ?? update?.callback_query?.from?.id ?? "";

  const lang = getLangFromUpdate(update);
  const name = getName(update);
  const text = (update?.message?.text || "").trim();

  // /start — привітання на мові акаунта TG
  if (/^\/start\b/i.test(text)) {
    await sendPlain(env, chatId, t(lang, "hello", name), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true });
  }

  // ——— Кнопки клавіатури ———
  if (text === BTN_SENTI) {
    await sendPlain(env, chatId, t(lang, "whoami"), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true });
  }

  if (text === BTN_LEARN) {
    // Подказка про режим навчання відповідною мовою
    await sendPlain(env, chatId, t(lang, "learn_hint"), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true });
  }

  if (text === BTN_DRIVE) {
    // Делегуємо існуючому flow авторизації Google Drive
    const host = env.SERVICE_HOST || `${env.name}.workers.dev`;
    const link = `https://${host}/auth/start?u=${encodeURIComponent(
      String(userId)
    )}`;

    // Виводимо як Markdown-посилання без прев’ю
    await sendPlain(
      env,
      chatId,
      `[↗️ ${t(lang, "btn_open_drive") || "Open Drive"}](${link})`,
      {
        parse_mode: "Markdown",
        reply_markup: mainKeyboard(ADMIN(env, userId)),
      }
    );
    return json({ ok: true });
  }

  // ——— Адмінка ———
  if (text === BTN_ADMIN && ADMIN(env, userId)) {
    const { energy, checklist } = energyLinks(env, userId);
    const learnUrl = `https://${
      env.SERVICE_HOST || `${env.name}.workers.dev`
    }/admin/learn/html${
      env.WEBHOOK_SECRET
        ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}&u=${encodeURIComponent(
            String(userId)
          )}`
        : ""
    }`;

    const kb = {
      inline_keyboard: [
        [{ text: t(lang, "btn_open_checklist"), url: checklist }],
        [{ text: t(lang, "btn_energy"), url: energy }],
        [{ text: t(lang, "btn_learn"), url: learnUrl }],
      ],
    };

    await sendPlain(
      env,
      chatId,
      `${t(lang, "admin_header")}\nMODEL_ORDER: ${
        env.MODEL_ORDER || "(not set)"
      }`,
      {
        reply_markup: kb,
        parse_mode: "HTML",
      }
    );
    return json({ ok: true });
  }

  // ——— Якщо користувач надіслав “голий” URL — додаємо у його чергу навчання ———
  const urlMatch = text.match(/\bhttps?:\/\/\S+/i);
  if (urlMatch) {
    const url = urlMatch[0];
    await enqueueLearn(env, String(userId), { url, name: url });
    await sendPlain(env, chatId, t(lang, "learn_added"), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true });
  }

  // ——— Фолбек — повторюємо підказку про Learn відповідною мовою ———
  await sendPlain(env, chatId, t(lang, "learn_hint"), {
    reply_markup: mainKeyboard(ADMIN(env, userId)),
  });
  return json({ ok: true });
}
