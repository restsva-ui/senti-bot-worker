// src/commands/menu.js
import { sendMessage } from "../adapters/telegram.js";

export default async function menu(env, chat_id) {
  return sendMessage(env, chat_id, "📋 Меню бота:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "👍 Лайк", callback_data: "like" },
          { text: "👎 Дизлайк", callback_data: "dislike" },
        ],
        [
          { text: "📊 Статистика", callback_data: "stats" },
        ],
        [
          { text: "ℹ️ Інфо", callback_data: "info" },
        ],
      ],
    },
  });
}