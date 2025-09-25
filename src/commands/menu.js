// src/commands/menu.js

import { sendMessage } from "../lib/tg.js";

export async function onMenu(env, chat_id) {
  const text = "📋 Меню:\n\nОберіть опцію нижче 👇";

  const keyboard = {
    inline_keyboard: [
      [
        { text: "👍 Лайки", callback_data: "likepanel" },
        { text: "📊 Статистика", callback_data: "stats" }
      ],
      [
        { text: "ℹ️ Про бота", callback_data: "about" }
      ]
    ]
  };

  return await sendMessage(env, chat_id, text, keyboard);
}