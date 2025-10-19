// src/routes/webhook.js
import { json } from "../utils/http.js";
import { TG, BTN_DRIVE, BTN_SENTI, BTN_LEARN, BTN_ADMIN, mainKeyboard, ADMIN, sendPlain } from "../lib/tg.js";
import { pickLang, t } from "../lib/i18n.js";
import { enqueueLearn } from "../lib/kvLearnQueue.js";
import { energyLinks } from "../lib/tg.js";

function getLangFromUpdate(update) {
  return pickLang(
    update?.message?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    "en"
  );
}

function getName(update) {
  return update?.message?.from?.first_name || update?.callback_query?.from?.first_name || "";
}

export async function handleTelegramWebhook(req, env) {
  const update = await req.json().catch(() => ({}));
  const chatId =
    update?.message?.chat?.id ??
    update?.callback_query?.message?.chat?.id ??
    null;
  if (!chatId) return json({ ok: true });

  const lang = getLangFromUpdate(update);
  const name = getName(update);
  const text = (update?.message?.text || "").trim();

  // /start
  if (/^\/start\b/i.test(text)) {
    await sendPlain(env, chatId, t(lang, "hello", name), {
      reply_markup: mainKeyboard(ADMIN(env, update?.message?.from?.id)),
    });
    return json({ ok: true });
  }

  // Кнопки клавіатури
  if (text === BTN_SENTI) {
    await sendPlain(env, chatId, t(lang, "whoami"), { reply_markup: mainKeyboard(ADMIN(env, update?.message?.from?.id)) });
    return json({ ok: true });
  }
  if (text === BTN_LEARN) {
    await sendPlain(env, chatId, t(lang, "learn_hint"), { reply_markup: mainKeyboard(ADMIN(env, update?.message?.from?.id)) });
    return json({ ok: true });
  }
  if (text === BTN_DRIVE) {
    // делегуємо існуючому flow авторизації
    const host = env.SERVICE_HOST || `${env.name}.workers.dev`;
    const u = `https://${host}/auth/start?u=${encodeURIComponent(update?.message?.from?.id || "")}`;
    await sendPlain(env, chatId, `[↗️ ${t(lang, "btn_open_checklist").replace("Checklist","Google Drive")}](${u})`, {
      parse_mode: "Markdown",
      reply_markup: mainKeyboard(ADMIN(env, update?.message?.from?.id)),
    });
    return json({ ok: true });
  }

  // “Admin”
  if (text === BTN_ADMIN && ADMIN(env, update?.message?.from?.id)) {
    const { energy, checklist } = energyLinks(env, update?.message?.from?.id);
    const learn = `https://${env.SERVICE_HOST || `${env.name}.workers.dev`}/admin/learn/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}&u=${encodeURIComponent(update?.message?.from?.id || "")}` : ""}`;
    const kb = {
      inline_keyboard: [
        [{ text: t(lang, "btn_open_checklist"), url: checklist }],
        [{ text: t(lang, "btn_energy"), url: energy }],
        [{ text: t(lang, "btn_learn"), url: learn }],
      ],
    };
    await sendPlain(env, chatId, `${t(lang, "admin_header")}\nMODEL_ORDER: ${env.MODEL_ORDER || "(not set)"}`, {
      reply_markup: kb,
      parse_mode: "HTML",
    });
    return json({ ok: true });
  }

  // Якщо користувач надіслав “голий” URL — додаємо у його чергу навчання
  const urlMatch = text.match(/\bhttps?:\/\/\S+/i);
  if (urlMatch) {
    const url = urlMatch[0];
    await enqueueLearn(env, update?.message?.from?.id, { url, name: url });
    await sendPlain(env, chatId, t(lang, "learn_added"));
    return json({ ok: true });
  }

  // Фолбек — повторюємо підказку про Learn
  await sendPlain(env, chatId, t(lang, "learn_hint"));
  return json({ ok: true });
}
