// Маршрутизатор апдейтів Telegram.
// Мінімальні зміни: для photo/document дістаємо file_url і передаємо в aiVision.

import { tgSendMessage, tgSendAction, tgGetFileUrl } from "./adapters/telegram.js";
import { aiText, aiVision } from "./ai/providers.js";

function pickLargestPhoto(photos) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  return photos[photos.length - 1]; // найбільша роздільна
}

function trimOrNull(s) {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length ? t : null;
}

export async function handleUpdate(update, env) {
  const msg = update?.message || update?.edited_message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userText = trimOrNull(msg.text ?? msg.caption ?? "");

  // 1) Фото
  if (msg.photo && msg.photo.length) {
    const largest = pickLargestPhoto(msg.photo);
    await tgSendAction(chatId, "upload_photo", env);

    const fileUrl = await tgGetFileUrl(largest.file_id, env);
    if (!fileUrl) {
      await tgSendMessage(chatId, "⚠️ Бачу зображення, але не зміг отримати URL для аналізу.", env);
      return;
    }

    // Підказка до зображення = caption або текст попереднього повідомлення
    const visionHint = userText || "Опиши головне на фото коротко і по суті.";
    const result = await aiVision(fileUrl, env, { hint: visionHint, source: "photo" });

    const safe = result?.trim() || "Не вдалося зробити висновок з цього зображення.";
    await tgSendMessage(chatId, safe, env);
    return;
  }

  // 2) Документ (зображення/PDF)
  if (msg.document) {
    await tgSendAction(chatId, "upload_document", env);

    const doc = msg.document;
    const mime = doc.mime_type || "";
    const fileUrl = await tgGetFileUrl(doc.file_id, env);

    if (!fileUrl) {
      await tgSendMessage(chatId, "⚠️ Бачу документ, але не зміг отримати URL для аналізу.", env);
      return;
    }

    if (mime.startsWith("image/") || mime === "application/pdf") {
      const visionHint = userText || (mime === "application/pdf"
        ? "Зроби стислий конспект вмісту PDF."
        : "Опиши головне на зображенні.");
      const result = await aiVision(fileUrl, env, { hint: visionHint, source: mime });
      const safe = result?.trim() || "Не вдалося зробити висновок з цього файлу.";
      await tgSendMessage(chatId, safe, env);
      return;
    }

    // Інші типи доків — просто скажемо, що поки не обробляємо
    await tgSendMessage(chatId, `Отримав документ (${mime}). Поки що вмію працювати із зображеннями та PDF.`, env);
    return;
  }

  // 3) Чистий текст
  if (userText) {
    await tgSendAction(chatId, "typing", env);
    const answer = await aiText(userText, env);
    const safe = answer?.trim() || "Готово! Я отримав твій запит і відповім простими словами:\n\n• (порожній запит)";
    await tgSendMessage(chatId, safe, env);
    return;
  }

  // 4) Фолбек
  await tgSendMessage(
    chatId,
    "👋 Надішли текст, фото чи PDF — опишу, витягну факти або зроблю короткий висновок.",
    env
  );
}