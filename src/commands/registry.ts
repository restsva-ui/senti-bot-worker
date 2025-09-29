// src/commands/registry.ts
import type { TgUpdate } from "../types";

export type CommandHandler = (update: TgUpdate, env: any) => Promise<void>;

// Імпортуємо модулі як namespace — незалежно від того, як саме вони експортують
import * as startModule from "./start";
import * as helpModule from "./help";
import * as pingModule from "./ping";
import * as healthModule from "./health";
import * as wikiModule from "./wiki";

// Допоміжна: обрати хендлер з модуля (named або default)
function pickHandler(mod: any, names: string[]): CommandHandler {
  for (const n of names) {
    if (typeof mod?.[n] === "function") return mod[n] as CommandHandler;
  }
  if (typeof mod?.default === "function") return mod.default as CommandHandler;
  throw new Error(`Command handler not found in module: ${names.join(", ")}`);
}

// Дістаємо основні хендлери
const start = pickHandler(startModule, ["start", "handleStart"]);
const help = pickHandler(helpModule, ["help", "handleHelp"]);
const ping = pickHandler(pingModule, ["ping", "handlePing"]);
const health = pickHandler(healthModule, ["health", "handleHealth"]);
const wiki = pickHandler(wikiModule, ["wiki", "handleWiki"]);

// Додаткові функції wiki (необов'язкові). Якщо нема — no-op.
export const wikiSetAwait:
  (update: TgUpdate, env: any) => Promise<void> | void =
  typeof (wikiModule as any).wikiSetAwait === "function"
    ? (wikiModule as any).wikiSetAwait
    : async () => {};

export const wikiMaybeHandleFreeText:
  (update: TgUpdate, env: any) => Promise<boolean> | boolean =
  typeof (wikiModule as any).wikiMaybeHandleFreeText === "function"
    ? (wikiModule as any).wikiMaybeHandleFreeText
    : async () => false;

// Головний реєстр команд
export const COMMANDS: Record<string, CommandHandler> = {
  start,
  help,
  ping,
  health,
  wiki,
};

// Пошук хендлера за назвою
export function findCommandByName(name: string): CommandHandler | undefined {
  if (!name) return undefined;
  return COMMANDS[name.toLowerCase()];
}

// Опис для /help
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

// Меню Telegram — показуємо лише те, що ми залишили у меню
export function getMenuCommands(): CommandInfo[] {
  return [
    { command: "help", description: "Довідка" },
    { command: "wiki", description: "Пошук у Вікіпедії" },
  ];
}