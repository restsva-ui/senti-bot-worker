// src/commands/help.ts
import { sendMessage } from "../telegram/api";

export async function help(chatId: number | string) {
  const text = [
    "🧾 Доступні команди:",
    "/start — запуск і привітання",
    "/ping — перевірка живості бота",
    "/menu — головне меню",
    "/likepanel — панель лайків",
    "/help — довідка",
  ].join("\n");
  await sendMessage(chatId, text);
}