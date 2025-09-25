// src/commands/menu.js
import { sendMessage } from "../lib/tg.js";

export async function onMenu(env, update) {
  if (!update.message) return;

  const chat_id = update.message.chat.id;

  // просте меню з inline-кнопками
  const keyboard = {
    inline_keyboard: [
      [
        { text: "📊 Статистика", callback_data: "stats" },
        { text: "👍 Лайки", callback_data: "likepanel" },
      ],
      [
        { text: "ℹ️ Про бота", callback_data: "about" }
      ]
    ]
  };

  await sendMessage(env, chat_id, "📋 Обери опцію з меню:", keyboard);
}