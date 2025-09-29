// src/commands/registry.ts
import type { TgUpdate } from "../types";

// Підписи до хендлерів-команд
export type CommandHandler = (update: TgUpdate, env: any) => Promise<void>;

// Імпорти команд (залиш тільки ті файли, які реально існують)
import { start } from "./start";
import { help } from "./help";
import { ping } from "./ping";
import { health } from "./health";
import { wiki, wikiSetAwait, wikiMaybeHandleFreeText } from "./wiki";

// Головний реєстр: команда -> хендлер
export const COMMANDS: Record<string, CommandHandler> = {
  start,
  help,
  ping,
  health,
  wiki,
};

// Для сумісності зі старим роутером
export function findCommandByName(name: string): CommandHandler | undefined {
  if (!name) return undefined;
  return COMMANDS[name.toLowerCase()];
}

// Для /help — короткі описи команд
export type CommandInfo = { command: string; description: string };

export function getCommandsInfo(): CommandInfo[] {
  return [
    { command: "start",  description: "Запуск і вітання" },
    { command: "help",   description: "Довідка" },
    { command: "wiki",   description: "Пошук у Вікіпедії" },
    { command: "ping",   description: "Перевірка зв'язку (pong)" },
    { command: "health", description: "Перевірка стану" },
  ];
}

/**
 * Мінімальний набір для офіційного меню Telegram.
 * Ми показуємо тільки те, що ти просив: help і wiki.
 */
export function getMenuCommands(): CommandInfo[] {
  return [
    { command: "help", description: "Довідка" },
    { command: "wiki", description: "Пошук у Вікіпедії" },
  ];
}

// РЕЕКСПОРТИ, якщо десь імпортуються з registry
export { wikiMaybeHandleFreeText, wikiSetAwait };