import { sendMessage } from "../telegram";

export async function menu(chatId: number) {
  await sendMessage(chatId, "Головне меню:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔄 Ping", callback_data: "cb_ping" }],
        [{ text: "👍 Лайки", callback_data: "cb_likepanel" }],
        [{ text: "ℹ️ Допомога", callback_data: "cb_help" }],
      ],
    },
  });
}