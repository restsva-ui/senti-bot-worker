// src/adapters/telegram.js

// Базова функція для виклику Telegram API
export async function tg(env, method, body) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json;charset=UTF-8" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Telegram API error [${method}]:`, await res.text());
  }
  return res.json();
}

// Відправка текстового повідомлення
export async function sendMessage(env, chat_id, text, extra = {}) {
  return tg(env, "sendMessage", {
    chat_id,
    text,
    parse_mode: "HTML", // можна писати <b>жирний</b>, <i>курсив</i>
    ...extra,
  });
}

// Відправка фото
export async function sendPhoto(env, chat_id, photo, caption = "", extra = {}) {
  return tg(env, "sendPhoto", {
    chat_id,
    photo,
    caption,
    parse_mode: "HTML",
    ...extra,
  });
}

// Відправка документа
export async function sendDocument(env, chat_id, file_id, caption = "", extra = {}) {
  return tg(env, "sendDocument", {
    chat_id,
    document: file_id,
    caption,
    parse_mode: "HTML",
    ...extra,
  });
}

// Редагування тексту повідомлення
export async function editMessageText(env, chat_id, message_id, text, extra = {}) {
  return tg(env, "editMessageText", {
    chat_id,
    message_id,
    text,
    parse_mode: "HTML",
    ...extra,
  });
}

// Відповідь на callback (кнопки)
export async function answerCallbackQuery(env, callback_query_id, text = "", show_alert = false) {
  return tg(env, "answerCallbackQuery", {
    callback_query_id,
    text,
    show_alert,
  });
}