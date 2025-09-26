// src/router.ts
import { menu } from "./commands/menu";
import { likePanel, handleLikeCallback } from "./commands/likepanel";
import { sendMessage, answerCallbackQuery } from "./telegram/api";
import { CFG } from "./config";

export async function handleUpdate(update: any) {
  try {
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text?.trim();

      switch (text) {
        case "/start":
          await sendMessage(chatId, "👋 Привіт! Бот підключено до Cloudflare Workers. Напишіть /help для довідки.");
          break;
        case "/ping":
          await sendMessage(chatId, "pong ✅");
          break;
        case "/help":
          await sendMessage(
            chatId,
            "📖 Доступні команди:\n" +
              "/start — запуск і привітання\n" +
              "/ping — перевірка живості бота\n" +
              "/menu — головне меню\n" +
              "/likepanel — панель лайків\n" +
              "/help — довідка"
          );
          break;
        case "/menu":
          await menu(chatId);
          break;
        case "/likepanel":
          await likePanel(chatId);
          break;
      }
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const data = cq.data;

      if (!chatId || !data) return;

      switch (data) {
        case "cb_ping":
          await answerCallbackQuery(cq.id, "pong ✅");
          await sendMessage(chatId, "pong ✅");
          break;
        case "cb_likepanel":
          await likePanel(chatId);
          break;
        case "cb_help":
          await sendMessage(
            chatId,
            "📖 Доступні команди:\n" +
              "/start — запуск і привітання\n" +
              "/ping — перевірка живості бота\n" +
              "/menu — головне меню\n" +
              "/likepanel — панель лайків\n" +
              "/help — довідка"
          );
          break;
        case "like":
        case "dislike":
          await handleLikeCallback(chatId, data, cq.id, cq.message);
          break;
        default:
          await answerCallbackQuery(cq.id, "🤷‍♂️ Невідома дія кнопки.");
      }
    }
  } catch (err) {
    console.error("handleUpdate fatal:", err);
  }
}