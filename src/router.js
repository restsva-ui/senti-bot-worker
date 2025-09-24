// src/router.js

import { tgSendMessage, tgSendChatAction, tgGetFileUrl } from "./adapters/telegram.js";
import { aiText, aiVision } from "./ai/providers.js";

/** Простий словник для трьох мов */
function t(key, lang = "uk") {
  const L = (lang || "uk").startsWith("ru") ? "ru"
        : (lang || "uk").startsWith("uk") ? "uk"
        : "en";

  const dict = {
    uk: {
      hello: "👋 Привіт! Я Senti — твій уважний помічник.\n• Надішли текст — відповім коротко і по суті.\n• Пришли фото чи PDF — опишу і зроблю висновки.\nСпробуй: просто напиши думку або кинь картинку.",
      empty: "Готово! Я отримав твій запит і відповім простими словами:\n\n• (порожній запит)",
      typing: "Думаю над відповіддю…",
      seenNoUrl: "Бачу зображення, але не отримав його URL для аналізу.",
      docSaved: "Завантажив файл. Спробую проаналізувати…",
      oops: "Вибач, сталась помилка. Спробуй ще раз.",
    },
    ru: {
      hello: "👋 Привет! Я Senti — твой внимательный помощник.\n• Пришли текст — отвечу кратко и по делу.\n• Отправь фото или PDF — опишу и сделаю выводы.\nПопробуй: просто напиши мысль или пришли картинку.",
      empty: "Готово! Я получил твой запрос и отвечу простыми словами:\n\n• (пустой запрос)",
      typing: "Думаю над ответом…",
      seenNoUrl: "Вижу изображение, но не получил его URL для анализа.",
      docSaved: "Загрузил файл. Попробую проанализировать…",
      oops: "Прости, произошла ошибка. Попробуй ещё раз.",
    },
    en: {
      hello: "👋 Hi! I’m Senti — your concise assistant.\n• Send text — I’ll answer briefly.\n• Send a photo or PDF — I’ll describe it and summarize.\nTry it: just type a thought or drop an image.",
      empty: "Got it! I received your request and will reply in simple words:\n\n• (empty request)",
      typing: "Thinking…",
      seenNoUrl: "I see an image, but didn’t get its URL for analysis.",
      docSaved: "File received. Let me analyze…",
      oops: "Sorry, something went wrong. Please try again.",
    },
  };

  return dict[L][key];
}

function pickLang(update) {
  // Telegram зазвичай передає language_code у from.language_code
  return update?.message?.from?.language_code || "uk";
}

function getText(m) {
  if (!m) return "";
  if (typeof m.text === "string") return m.text.trim();
  if (m.caption) return String(m.caption).trim();
  return "";
}

export default {
  async fetch(request, env) {
    try {
      // (Опційно) перевірка секрету вебхука
      const secret = env.WEBHOOK_SECRET;
      if (secret) {
        const got = request.headers.get("x-telegram-bot-api-secret-token");
        if (got !== secret) {
          return new Response("Forbidden", { status: 403 });
        }
      }

      if (request.method !== "POST") {
        return new Response("ok", { status: 200 });
      }

      const update = await request.json().catch(() => ({}));
      const msg = update.message || update.edited_message || null;
      if (!msg) return new Response("ok", { status: 200 });

      const chatId = msg.chat?.id;
      const lang = pickLang({ message: msg });

      // /start
      const text = getText(msg);
      if (text?.startsWith("/start")) {
        await tgSendMessage(env, chatId, t("hello", lang));
        return new Response("ok", { status: 200 });
      }

      // PHOTO
      if (msg.photo && Array.isArray(msg.photo) && msg.photo.length) {
        // беремо найбільше фото (останній елемент)
        const best = msg.photo[msg.photo.length - 1];
        const fileId = best.file_id;
        const url = await tgGetFileUrl(env, fileId);

        if (!url) {
          await tgSendMessage(env, chatId, t("seenNoUrl", lang), { reply_to_message_id: msg.message_id });
          return new Response("ok", { status: 200 });
        }

        await tgSendChatAction(env, chatId, "typing");
        const prompt = getText(msg) || "Опиши зображення";

        try {
          const result = await aiVision(url, env, { prompt, lang });
          const reply = (result && (result.summary || result.text || result.caption)) || t("oops", lang);
          await tgSendMessage(env, chatId, reply, { reply_to_message_id: msg.message_id });
        } catch (e) {
          console.error("aiVision error:", e);
          await tgSendMessage(env, chatId, t("oops", lang), { reply_to_message_id: msg.message_id });
        }

        return new Response("ok", { status: 200 });
      }

      // DOCUMENT (PDF / images)
      if (msg.document) {
        const fileId = msg.document.file_id;
        const mime = msg.document.mime_type || "";
        const url = await tgGetFileUrl(env, fileId);

        if (!url) {
          await tgSendMessage(env, chatId, t("seenNoUrl", lang), { reply_to_message_id: msg.message_id });
          return new Response("ok", { status: 200 });
        }

        await tgSendChatAction(env, chatId, "typing");

        // Для PDF та image/* запускаємо aiVision
        if (mime === "application/pdf" || mime.startsWith("image/")) {
          const prompt = getText(msg) || "Зроби короткий висновок";
          try {
            const result = await aiVision(url, env, { prompt, lang });
            const reply = (result && (result.summary || result.text || result.caption)) || t("oops", lang);
            await tgSendMessage(env, chatId, reply, { reply_to_message_id: msg.message_id });
          } catch (e) {
            console.error("aiVision error:", e);
            await tgSendMessage(env, chatId, t("oops", lang), { reply_to_message_id: msg.message_id });
          }
        } else {
          // інші типи документів поки не обробляємо
          await tgSendMessage(env, chatId, t("docSaved", lang), { reply_to_message_id: msg.message_id });
        }

        return new Response("ok", { status: 200 });
      }

      // TEXT (звичайний діалог)
      if (text && !text.startsWith("/")) {
        await tgSendChatAction(env, chatId, "typing");
        try {
          const out = await aiText(text, env, { lang });
          const reply = (out && (out.answer || out.text || out.summary)) || t("empty", lang);
          await tgSendMessage(env, chatId, reply, { reply_to_message_id: msg.message_id });
        } catch (e) {
          console.error("aiText error:", e);
          await tgSendMessage(env, chatId, t("oops", lang), { reply_to_message_id: msg.message_id });
        }
        return new Response("ok", { status: 200 });
      }

      // Якщо нічого не підійшло
      await tgSendMessage(env, chatId, t("empty", lang), { reply_to_message_id: msg?.message_id });
      return new Response("ok", { status: 200 });
    } catch (e) {
      console.error("router fatal:", e);
      return new Response("ok", { status: 200 });
    }
  },
};