import { cmdPing } from "./commands/ping";
import { cmdStart } from "./commands/start";
import { cmdMenu } from "./commands/menu";
import { sendMessage } from "./telegram/api";

export async function routeUpdate(update: any) {
  const msg = update.message;
  const cb  = update.callback_query;

  if (msg?.text?.startsWith("/")) {
    const chatId = msg.chat.id;
    const [cmd] = msg.text.split(/\s+/);
    switch (cmd) {
      case "/start": return cmdStart(chatId);
      case "/ping":  return cmdPing(chatId);
      case "/menu":  return cmdMenu(chatId);
      default:
        return sendMessage(chatId, "Невідома команда. Спробуйте /menu або /ping");
    }
  }

  if (cb) {
    const chatId = cb.message.chat.id;
    if (cb.data === "likepanel") {
      return sendMessage(chatId, "Тут буде панель лайків (callback)");
    }
  }
}