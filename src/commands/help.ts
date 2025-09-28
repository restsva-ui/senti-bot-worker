// src/commands/help.ts
import { sendMessage } from "../utils/telegram";

export async function handleHelp(chatId: number) {
  const text = `
🤖 *Senti — доступні команди:*
/start — запустити бота
/ping — перевірити відповідь
/health — стан воркера
/help — список команд
  `.trim();

  await sendMessage(chatId, text, { parse_mode: "Markdown" });
}