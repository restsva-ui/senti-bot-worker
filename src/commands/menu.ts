// src/commands/menu.ts
import { sendMessage } from "../telegram/api";

export async function menu(chatId: number) {
  await sendMessage(
    chatId,
    "Головне меню:",
    {
      inline_keyboard: [
        [{ text: "🔁 Ping", callback_data: "cb_ping" }],
        [{ text: "👍 Лайки", callback_data: "cb_likepanel" }],
        [{ text: "ℹ️ Допомога", callback_data: "cb_help" }],
      ],
    }
  );
}