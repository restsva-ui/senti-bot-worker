import { sendMessage } from "../telegram/api";

export async function menu(chatId: number) {
  const replyMarkup = {
    inline_keyboard: [
      [{ text: "🔁 Ping", callback_data: "cb_ping" }],
      [{ text: "👍 Лайки", callback_data: "cb_menu_likepanel" }],
      [{ text: "ℹ️ Допомога", callback_data: "cb_help" }],
    ],
  };
  await sendMessage(chatId, "Головне меню:", replyMarkup);
}