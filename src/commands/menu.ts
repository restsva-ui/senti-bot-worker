// src/commands/menu.ts
import { sendMessage } from "../telegram/api";

export async function menu(chatId: number) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "↪️ Ping", callback_data: "cb_ping" },
      ],
      [
        // відкриває панель лайків
        { text: "👍 Лайки", callback_data: "cb_likepanel" },
      ],
      [
        { text: "ℹ️ Допомога", callback_data: "cb_help" },
      ],
    ],
  };

  await sendMessage(chatId, "Головне меню:", keyboard);
}