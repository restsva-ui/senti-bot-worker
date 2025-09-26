import { sendMessage } from "../telegram/api";

export async function help(chatId: number) {
  const txt =
    "🧾 Доступні команди:\n" +
    "/start — запуск і привітання\n" +
    "/ping — перевірка живості бота\n" +
    "/menu — головне меню\n" +
    "/likepanel — панель лайків\n" +
    "/help — довідка";
  await sendMessage(chatId, txt);
}