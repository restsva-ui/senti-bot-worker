// src/commands/menu.ts
import { tgSendMessage, tgEditMessageReplyMarkup } from "../utils/telegram";
import type { Env } from "../index";

export async function menuCommand(env: Env, chatId: number) {
  await tgSendMessage(env as any, chatId, "📍 Головне меню:", {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🧠 Задати питання", callback_data: "menu:ask" },
          { text: "📖 Вікі", callback_data: "menu:wiki" },
        ],
        [
          { text: "👍 Лайки", callback_data: "menu:likes" },
          { text: "⚙️ Налаштування", callback_data: "menu:settings" },
        ],
        [{ text: "ℹ️ Допомога", callback_data: "menu:help" }],
      ],
    },
  });
}

export async function menuOnCallback(env: Env, update: any) {
  const data = update?.callback_query?.data;
  const chatId = update?.callback_query?.message?.chat?.id;

  if (!chatId || !data) return;

  switch (data) {
    case "menu:ask":
      await tgSendMessage(env as any, chatId, "Введи своє питання з /ask ...");
      break;
    case "menu:wiki":
      await tgSendMessage(env as any, chatId, "Увімкнено вікі-режим. Напиши термін 👇");
      break;
    case "menu:likes":
      await tgSendMessage(env as any, chatId, "Ось розділ 👍 Лайки");
      break;
    case "menu:settings":
      await tgSendMessage(env as any, chatId, "⚙️ Налаштування:", {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🌐 Мова", callback_data: "settings:lang" },
              { text: "🎨 Тема", callback_data: "settings:theme" },
            ],
            [
              { text: "🔔 Нотифікації", callback_data: "settings:notify" },
              { text: "⬅️ Назад", callback_data: "menu:back" },
            ],
          ],
        },
      });
      break;
    case "menu:help":
      await tgSendMessage(env as any, chatId, "ℹ️ Доступні команди: /ask /wiki /likes /menu /help");
      break;
    case "menu:back":
      await menuCommand(env, chatId);
      break;
    default:
      await tgSendMessage(env as any, chatId, `tap: ${data}`);
  }
}