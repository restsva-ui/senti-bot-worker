// src/router.js
// Простий роутер Telegram-вебхука: /start, текст, фото/документи.
// Не світимо моделі у вітальному тексті. Підтримує edited_message та callback_query.

import { tgSendMessage, tgSendAction, tgGetFileUrl } from "./adapters/telegram.js";
import { aiText, aiVision } from "./ai/providers.js";

const WELCOME =
  "👋 Привіт! Я Senti — твій уважний помічник.\n" +
  "• Надішли текст — відповім коротко і по суті.\n" +
  "• Пришли фото чи PDF — опишу і зроблю висновки.\n" +
  "Спробуй: просто напиши думку або кинь картинку.";

function extractMessage(update) {
  // Підтримує message, edited_message, callback_query
  if (update?.message) return update.message;
  if (update?.edited_message) return update.edited_message;
  if (update?.callback_query?.message) return update.callback_query.message;
  return null;
}

function extractText(update, msg) {
  // Повертаємо: text -> callback data -> caption -> ""
  return (
    update?.message?.text ??
    update?.edited_message?.text ??
    update?.callback_query?.data ??
    msg?.caption ??
    ""
  ).trim();
}

async function fetchFileBytes(fileUrl) {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function handleUpdate(update, env) {
  try {
    // Якщо це технічний пінг або сміттєвий запит — просто 200 OK
    if (!update || typeof update !== "object") {
      return new Response("ok", { status: 200 });
    }

    // Легкий лог ключів апдейта для діагностики
    try {
      const keys = Object.keys(update);
      console.log("TG update keys:", ...keys);
    } catch {}

    const msg = extractMessage(update);
    if (!msg || !msg.chat) {
      // Нема чату — нічого відповідати
      return new Response("ok", { status: 200 });
    }

    const chatId = msg.chat.id;
    const text = extractText(update, msg);

    // /start -> дружнє вітання
    if (text.startsWith("/start")) {
      await tgSendMessage(env, chatId, WELCOME);
      return new Response("ok", { status: 200 });
    }

    // Фото або документ -> vision
    if (msg.photo?.length || msg.document) {
      await tgSendAction(env, chatId, "upload_photo");

      // берeмо найбільше фото або документ
      let fileId;
      if (msg.photo?.length) {
        const biggest = msg.photo.reduce((a, b) =>
          (a.file_size || 0) > (b.file_size || 0) ? a : b
        );
        fileId = biggest.file_id;
      } else if (msg.document) {
        fileId = msg.document.file_id;
      }

      try {
        const fileUrl = await tgGetFileUrl(env, fileId);
        const bytes = await fetchFileBytes(fileUrl);
        const visionResult = await aiVision(env, bytes, {
          filename: msg.document?.file_name,
          mime: msg.document?.mime_type,
        });

        const reply =
          (msg.caption?.trim() ? `📝 Твій підпис: ${msg.caption.trim()}\n\n` : "") +
          (visionResult?.trim() || "Я отримав файл, але не зміг його проаналізувати.");

        await tgSendMessage(env, chatId, reply);
      } catch (e) {
        console.error("Vision error:", e?.stack || e?.message || e);
        await tgSendMessage(
          env,
          chatId,
          "Не вийшло обробити файл 🤖. Спробуй інший формат або менший розмір."
        );
      }

      return new Response("ok", { status: 200 });
    }

    // Звичайний текст -> коротка відповідь
    if (text) {
      await tgSendAction(env, chatId, "typing");
      try {
        const answer = await aiText(env, text, {
          user: msg.from?.id,
          name: msg.from?.first_name,
          username: msg.from?.username,
          lang: msg.from?.language_code,
        });

        await tgSendMessage(env, chatId, answer || "Готово ✅");
      } catch (e) {
        console.error("aiText error:", e?.stack || e?.message || e);
        await tgSendMessage(env, chatId, "Завис трішки. Спробуй перефразувати ✍️");
      }
      return new Response("ok", { status: 200 });
    }

    // Якщо прийшло щось інше (стикери тощо) — ввічлива відповідь
    await tgSendMessage(env, chatId, "Надішли, будь ласка, текст або файл/фото 📎");
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Router fatal:", err?.stack || err?.message || err);
    // Завжди 200 для Telegram, щоб не ретраїв
    return new Response("ok", { status: 200 });
  }
}