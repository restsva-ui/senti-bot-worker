// src/commands/menu.ts
import type { TgUpdate } from "../types";
import { sendMessage } from "../utils/telegram";

export const menuCommand = {
  name: "menu",
  description: "Показує спрощене меню з кнопками (Help, Wiki)",
  async execute(env: { BOT_TOKEN: string; API_BASE_URL?: string }, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    // ReplyKeyboard з двома кнопками: /help та /wiki
    const keyboard = {
      keyboard: [
        [{ text: "/help" }, { text: "/wiki" }],
      ],
      resize_keyboard: true,
      one_time_keyboard: false,
      selective: false,
    };

    await sendMessage(env, chatId, "📋 Меню:", {
      reply_markup: keyboard,
    });
  },
} as const;

export default menuCommand;