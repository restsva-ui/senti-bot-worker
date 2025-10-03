// src/commands/sync.ts
import { setMyCommands } from "../utils/telegram";
import type { Env } from "../index";

/** Єдиний канонічний список команд бота (без wiki). */
export function commandsList() {
  return [
    { command: "start", description: "Запустити бота" },
    { command: "help",  description: "Довідка" },
    { command: "ping",  description: "Перевірка зв'язку" },
    { command: "likes", description: "Керувати вподобайками" },
    { command: "stats", description: "Статистика" },
    { command: "menu",  description: "Меню" },
    { command: "ask",   description: "Запит до ШІ" },
  ];
}

/** Виставляє команди через Telegram API. */
export async function syncCommands(env: Env) {
  const commands = commandsList();
  return setMyCommands(env as any, commands);
}