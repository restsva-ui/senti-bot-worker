// src/routes/webhook.js
import { json, CORS } from "../utils/http.js";
import { TG, BTN_DRIVE, BTN_SENTI, BTN_LEARN, BTN_ADMIN, mainKeyboard, ADMIN, sendPlain, energyLinks } from "../lib/tg.js";
import { pickLang, t } from "../lib/i18n.js";
import { enqueueLearn } from "../lib/kvLearnQueue.js";

function isUrl(s) {
  try { new URL(s); return true; } catch { return false; }
}

function extractUrlFromMessage(msg) {
  const text = msg?.text || msg?.caption || "";
  if (!text) return null;
  const m = text.match(/https?:\/\/\S+/i);
  return m ? m[0] : null;
}

export async function handleWebhook(env, req) {
  // Validate X-Telegram secret if ти його ставив при setWebhook
  const tgSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_WEBHOOK_SECRET && tgSecret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: "forbidden" }, 403, CORS);
  }

  const update = await req.json().catch(() => null);
  if (!update) return json({ ok: false, error: "bad json" }, 400, CORS);

  const msg = update.message || update.edited_message || update.channel_post || update.callback_query?.message;
  if (!msg) return json({ ok: true, skip: "no_message" }, 200, CORS);

  const chatId = msg.chat?.id;
  const userId = msg.from?.id;
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ").trim();
  const lang = pickLang(update);

  // /start — показати клавіатуру + вітання
  const text = msg.text || "";
  if (text.startsWith("/start")) {
    await sendPlain(env, chatId, `${t(lang, "hello", name)}\n\n${t(lang, "main_hint")}`, {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true }, 200, CORS);
  }

  // Кнопки (reply keyboard)
  if ([BTN_DRIVE, BTN_SENTI, BTN_LEARN, BTN_ADMIN].includes(text)) {
    if (text === BTN_LEARN) {
      await sendPlain(env, chatId, t(lang, "learn_hint"), {
        reply_markup: mainKeyboard(ADMIN(env, userId)),
      });
      return json({ ok: true }, 200, CORS);
    }
    if (text === BTN_ADMIN && ADMIN(env, userId)) {
      const { energyHtml } = energyLinks(env, userId);
      await sendPlain(env, chatId, `${t(lang, "admin_header")}\n${energyHtml}`);
      return json({ ok: true }, 200, CORS);
    }
    // Інші кнопки — просте eco-echo
    await sendPlain(env, chatId, t(lang, "whoami"), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true }, 200, CORS);
  }
  // Якщо є URL у повідомленні — додаємо у чергу Learn
  const url = extractUrlFromMessage(msg);
  if (url && isUrl(url)) {
    await enqueueLearn(env, String(userId), { url, name: url });
    await sendPlain(env, chatId, t(lang, "learn_added"), {
      reply_markup: mainKeyboard(ADMIN(env, userId)),
    });
    return json({ ok: true }, 200, CORS);
  }

  // Фолбек підказка
  await sendPlain(env, chatId, t(lang, "main_hint"), {
    reply_markup: mainKeyboard(ADMIN(env, userId)),
  });
  return json({ ok: true }, 200, CORS);
}
