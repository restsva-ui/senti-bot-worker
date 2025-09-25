import { tg } from "../lib/tg.js";

export async function onMenu(env, chatId) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "Меню:",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "❤️ Like", callback_data: "like:panel" },
          { text: "📊 Статистика", callback_data: "stats:view" },
        ],
        [
          // приклад зовнішнього посилання
          { text: "🌐 Відкрити сайт", url: "https://cloudflare.com" }
        ]
      ]
    }
  });
}