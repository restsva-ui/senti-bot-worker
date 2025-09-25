import { sendMessage } from "../telegram/api";
export async function cmdMenu(chatId: string|number) {
  await sendMessage(chatId, "Оберіть дію:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "👍 Панель лайків", callback_data: "likepanel" }],
        [{ text: "📊 Статистика", callback_data: "stats" }],
      ]
    }
  });
}