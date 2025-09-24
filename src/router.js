// Дуже простий роутер: команда /start і все інше як текст/медіа.
// Пізніше докрутимо vision/documents/codegen.

import { tgSendMessage, tgSendChatAction, tgGetFileUrl } from "./adapters/telegram.js";
import { aiText, aiVision } from "./ai/providers.js";

/**
 * Головний обробник апдейтів від Telegram (webhook)
 * @param {object} update - об’єкт апдейту з Telegram
 * @param {object} env    - середовище воркера (env vars, bindings)
 */
export async function handleUpdate(update, env) {
  // Мінімальна валідація
  const msg = update?.message;
  if (!msg || !msg.chat) return;

  const chatId = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? "").trim();

  // 1) /start — коротке дружнє вітання (без згадки моделей)
  if (text.startsWith("/start")) {
    const hello =
      "👋 Привіт! Я на зв’язку. Надішли текст — відповім лаконічно. " +
      "Пришли фото/файл — опишу й допоможу з висновками.";
    await tgSendMessage(env, chatId, hello);
    return;
  }

  // Показуємо "typing..." поки обробляємо
  await tgSendChatAction(env, chatId, "typing");

  // 2) Якщо є фото — беремо найбільше за розміром
  if (msg.photo && Array.isArray(msg.photo) && msg.photo.length > 0) {
    const biggest = msg.photo.reduce((a, b) => (a.file_size > b.file_size ? a : b));
    const fileUrl = await tgGetFileUrl(env, biggest.file_id);
    const prompt = text || "Опиши це зображення, дай короткі висновки.";
    const result = await aiVision(env, fileUrl, prompt);
    await tgSendMessage(env, chatId, result);
    return;
  }

  // 3) Документи/файли (pdf, docx, txt, тощо) — поки просто даємо лінк і заглушку
  if (msg.document) {
    const fileUrl = await tgGetFileUrl(env, msg.document.file_id);
    const prompt =
      text ||
      `Є файл ${msg.document.file_name ?? ""}. Зроби короткий огляд вмісту (якщо це текст/пдф).`;
    const result = await aiVision(env, fileUrl, prompt);
    await tgSendMessage(env, chatId, result);
    return;
  }

  // 4) Якщо це звичайний текст — віддаємо у aiText
  if (text) {
    const result = await aiText(env, text);
    await tgSendMessage(env, chatId, result);
    return;
  }

  // 5) Інші типи — просто чемно відповімо
  await tgSendMessage(env, chatId, "Я поки що розумію текст, фото та документи. Спробуєш одне з цього? 😊");
}