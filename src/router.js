import { tgSendMessage, tgSendChatAction, tgGetFileUrl } from "./adapters/telegram.js";
import { aiText, aiVision } from "./ai/providers.js";

// Лаконічне вітання без згадки моделей
const START_TEXT =
  "Привіт! Надішли текст — відповім коротко й по суті. Надішли фото — опишу й додам висновки. Я поруч. 🧠";

export async function handleUpdate(update, env) {
  const msg = update?.message;
  if (!msg) return;

  const chatId = msg.chat?.id;
  if (!chatId) return;

  const text = (msg.text ?? msg.caption ?? "").trim();

  // /start
  if (text.startsWith("/start")) {
    await tgSendMessage(env.TELEGRAM_TOKEN, chatId, START_TEXT);
    return;
    }

  // Фото або документ-зображення
  const photoArr = msg.photo;
  const doc = msg.document;
  const hasImage =
    (Array.isArray(photoArr) && photoArr.length > 0) ||
    (doc && typeof doc.mime_type === "string" && doc.mime_type.startsWith("image/"));

  if (hasImage) {
    await tgSendChatAction(env.TELEGRAM_TOKEN, chatId, "upload_photo");

    // беремо найбільше фото або document.file_id
    const fileId =
      (Array.isArray(photoArr) && photoArr[photoArr.length - 1]?.file_id) ||
      (doc && doc.file_id) ||
      null;

    if (!fileId) {
      await tgSendMessage(env.TELEGRAM_TOKEN, chatId, "Не вдалося отримати зображення 😕");
      return;
    }

    const fileUrl = await tgGetFileUrl(env.TELEGRAM_TOKEN, fileId);
    if (!fileUrl) {
      await tgSendMessage(env.TELEGRAM_TOKEN, chatId, "Не вдалося завантажити фото.");
      return;
    }

    const prompt =
      text ||
      "Опиши детально, що на фото. Додай короткі висновки та можливі наступні кроки користувача.";

    const answer = await aiVision({ prompt, imageUrl: fileUrl }, env);
    await tgSendMessage(env.TELEGRAM_TOKEN, chatId, answer);
    return;
  }

  // Звичайний текст
  if (text) {
    await tgSendChatAction(env.TELEGRAM_TOKEN, chatId, "typing");
    const answer = await aiText({ prompt: text }, env);
    await tgSendMessage(env.TELEGRAM_TOKEN, chatId, answer);
    return;
  }

  // Нічого корисного не прийшло
  await tgSendMessage(env.TELEGRAM_TOKEN, chatId, "Надішли, будь ласка, текст або фото 🙂");
}