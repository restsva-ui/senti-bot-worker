// src/router.js

import { tgSendMessage, tgSendChatAction, tgGetFileUrl } from "./adapters/telegram.js";
import { aiText, aiVision } from "./ai/providers.js";

/**
 * Перевірка секрету вебхука:
 *  - шлях типу /<WEBHOOK_SECRET>
 *  - та/або заголовок X-Telegram-Bot-Api-Secret-Token
 */
function isFromTelegram(request, env, pathname) {
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  const pathOk =
    pathname === `/${env.WEBHOOK_SECRET}` ||
    pathname === `/${env.WEBHOOK_SECRET}/`;
  const headerOk = headerSecret && headerSecret === env.WEBHOOK_SECRET;
  return pathOk || headerOk;
}

function pickLargestPhoto(photos = []) {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  return photos.reduce((a, b) => (a.file_size > b.file_size ? a : b));
}

function getLangFromMessage(msg) {
  // Якщо Telegram не дав language_code — повернемо 'uk' як дефолт
  return (msg?.from?.language_code || "uk").toLowerCase();
}

async function handleTextMessage(env, msg, text) {
  const chatId = msg.chat.id;

  if (text === "/start") {
    const hello =
      "👋 Привіт! Я Senti — твій уважний помічник.\n" +
      "• Надішли текст — відповім коротко і по суті.\n" +
      "• Пришли фото чи PDF — опишу і зроблю висновки.\n" +
      "Спробуй: просто напиши думку або кинь картинку.";
    return tgSendMessage(env.TELEGRAM_TOKEN, chatId, hello);
  }

  // Індикація "typing…"
  await tgSendChatAction(env.TELEGRAM_TOKEN, chatId, "typing");

  const lang = getLangFromMessage(msg);
  const result = await aiText(env, text, { lang, userId: String(msg.from?.id || "") });

  const reply =
    result?.text?.trim() ||
    "Готово! Я отримав твій запит і відповім простими словами:\n\n• (порожній запит)";
  return tgSendMessage(env.TELEGRAM_TOKEN, chatId, reply);
}

async function handleMediaMessage(env, msg) {
  const chatId = msg.chat.id;

  // Індикація "upload_photo" / "typing"
  await tgSendChatAction(env.TELEGRAM_TOKEN, chatId, "upload_photo");

  let fileId = null;
  let mediaKind = null;
  let caption = msg.caption || "";

  if (msg.photo && msg.photo.length) {
    const best = pickLargestPhoto(msg.photo);
    fileId = best?.file_id || msg.photo[msg.photo.length - 1]?.file_id;
    mediaKind = "photo";
  } else if (msg.document) {
    fileId = msg.document.file_id;
    mediaKind = "document";
  } else if (msg.sticker) {
    fileId = msg.sticker.file_id;
    mediaKind = "sticker";
  }

  if (!fileId) {
    return tgSendMessage(
      env.TELEGRAM_TOKEN,
      chatId,
      "Бачу зображення, але не отримав його URL для аналізу."
    );
  }

  const url = await tgGetFileUrl(env.TELEGRAM_TOKEN, fileId);
  if (!url) {
    return tgSendMessage(
      env.TELEGRAM_TOKEN,
      chatId,
      "Не вдалося отримати файл Telegram для аналізу."
    );
  }

  // Попросимо модель подивитися на зображення/док і дати стислий висновок
  const lang = getLangFromMessage(msg);
  const result = await aiVision(env, { url, caption, kind: mediaKind, lang });

  const reply =
    result?.text?.trim() ||
    "Завантажив файл. Скажи, що саме потрібно: виписати текст, знайти числа/дати, зробити короткий висновок тощо.";
  return tgSendMessage(env.TELEGRAM_TOKEN, chatId, reply);
}

async function handleUpdate(env, update) {
  try {
    const msg = update.message || update.edited_message;
    if (!msg) return;

    if (typeof msg.text === "string" && msg.text.trim().length > 0) {
      return await handleTextMessage(env, msg, msg.text.trim());
    }

    if (msg.photo || msg.document || msg.sticker) {
      return await handleMediaMessage(env, msg);
    }
  } catch (err) {
    console.error("router: handleUpdate error:", err);
  }
}

export default {
  /**
   * Cloudflare Worker entry
   */
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // Пінг для швидкої діагностики
    if (request.method === "GET" && pathname === "/") {
      return new Response("ok", { status: 200 });
    }

    if (request.method !== "POST") {
      return new Response("Not Found", { status: 404 });
    }

    // Приймаємо лише виклики Telegram на секретному маршруті
    if (!isFromTelegram(request, env, pathname)) {
      return new Response("Not Found", { status: 404 });
    }

    let update = null;
    try {
      update = await request.json();
    } catch {
      return new Response("Bad Request", { status: 400 });
    }

    // Обробляємо оновлення
    ctx.waitUntil(handleUpdate(env, update));
    return new Response("OK", { status: 200 });
  },
};