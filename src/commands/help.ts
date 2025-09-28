import { sendMessage } from "../utils/telegram";
import type { Env, TgUpdate } from "../types";

// Текст допомоги
export function helpText(): string {
  return [
    "📖 Доступні команди:",
    "",
    "/start – запуск і вітання",
    "/ping – перевірка звʼязку (pong)",
    "/health – перевірка стану сервера",
    "/help – список команд",
    "/wiki <запит> – коротка довідка з Вікіпедії (безкоштовно)",
    "",
    "⚡ Надалі будуть нові функції (AI, інтеграції тощо).",
  ].join("\n");
}

// Обробник команди /help
export async function cmdHelp(env: Env, update: TgUpdate): Promise<void> {
  if (!update.message) return;
  const chatId = update.message.chat.id;
  await sendMessage(env, chatId, helpText());
}

// Явний експорт для реєстрації в index.ts
export const helpCommand = {
  name: "help",
  description: "Список доступних команд",
  execute: cmdHelp,
};