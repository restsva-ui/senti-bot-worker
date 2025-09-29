// src/commands/registry.ts
import type { TgUpdate } from "../types";

export type CommandHandler = (update: TgUpdate, env: any) => Promise<void>;

// Імпортуємо всі модулі команд як namespace
import * as startModule from "./start";
import * as helpModule from "./help";
import * as pingModule from "./ping";
import * as healthModule from "./health";
import * as wikiModule from "./wiki";

/** Повертає першу функцію з модуля (як запасний варіант) */
function firstFunctionExport(mod: any): CommandHandler | undefined {
  if (!mod || typeof mod !== "object") return undefined;
  for (const k of Object.keys(mod)) {
    const v = (mod as any)[k];
    if (typeof v === "function") return v as CommandHandler;
  }
  return undefined;
}

/** Прагматично шукаємо хендлер у модулі */
function tryPickHandler(
  mod: any,
  candidates: string[]
): CommandHandler | undefined {
  // 1) іменовані
  for (const n of candidates) {
    if (typeof mod?.[n] === "function") return mod[n] as CommandHandler;
  }
  // 2) default як функція
  if (typeof mod?.default === "function")
    return mod.default as CommandHandler;

  // 3) перша будь-яка функція серед експортів
  return firstFunctionExport(mod);
}

/** Допоміжне: додати команду лише якщо є хендлер */
function addIf(handler: CommandHandler | undefined, name: string, to: Record<string, CommandHandler>) {
  if (typeof handler === "function") {
    to[name] = handler;
  }
}

// === Підхоплюємо хендлери (без винятків, усе «best effort») ===
const start = tryPickHandler(startModule, ["start", "handleStart"]);
const help = tryPickHandler(helpModule, ["help", "handleHelp"]);
const ping = tryPickHandler(pingModule, ["ping", "handlePing"]);
const health = tryPickHandler(healthModule, ["health", "handleHealth"]);
const wiki = tryPickHandler(wikiModule, ["wiki", "handleWiki"]);

// Додаткові функції wiki (необов’язкові)
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

// === Реєстр команд (лише наявні) ===
export const COMMANDS: Record<string, CommandHandler> = {};
addIf(start, "start", COMMANDS);
addIf(help, "help", COMMANDS);
addIf(ping, "ping", COMMANDS);
addIf(health, "health", COMMANDS);
addIf(wiki, "wiki", COMMANDS);

// Пошук за назвою
export function findCommandByName(name: string): CommandHandler | undefined {
  if (!name) return undefined;
  return COMMANDS[name.toLowerCase()];
}

// Інфо для /help (перелік усіх, навіть якщо частина не зареєструвалась — це ок)
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

// Меню Telegram — лише help та wiki
export function getMenuCommands(): CommandInfo[] {
  return [
    { command: "help", description: "Довідка" },
    { command: "wiki", description: "Пошук у Вікіпедії" },
  ];
}