import { sendMessage } from "../utils/telegram";
import type { Env, TgUpdate } from "../types";

export function helpText() {
  return [
    "Доступні команди:",
    "",
    "/start – запуск і вітання",
    "/ping – перевірка звʼязку (відповідь: pong)",
    "/health – перевірка стану сервера",
    "/help – список команд",
    "/wiki <запит> – коротка довідка з Вікіпедії (безкоштовно)",
    "",
    "⚡ Надалі будуть нові функції (AI, інтеграції тощо).",
  ].join("\n");
}

export async function cmdHelp(env: Env, update: TgUpdate) {
  const chatId = update.message!.chat.id;
  await sendMessage(env, chatId, helpText());
}