// src/adapters/telegram.js
// Невеличкий хелпер для Telegram API

export const telegramApi = (token) => ({
  sendMessage: (chat_id, text, parse_mode = "Markdown") =>
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id, text, parse_mode }),
    }),
});

export async function tgReplyText(api, chatId, text) {
  await api.sendMessage(chatId, text, "Markdown");
}

export async function tgReplyPhotoCaption(api, chatId, caption) {
  await api.sendMessage(chatId, caption, "Markdown");
}