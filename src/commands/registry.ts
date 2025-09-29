// src/commands/registry.ts
import type { TgUpdate } from "../types";

// Команди
import { startCommand } from "./start";
import { pingCommand } from "./ping";
import { healthCommand } from "./health";
import { helpCommand } from "./help";
import { wikiCommand } from "./wiki";
import { echoCommand } from "./echo";
import { menuCommand } from "./menu";
import { likesCommand } from "./likes";
import { statsCommand } from "./stats";

/** Мінімальний контракт середовища, потрібний командам */
export type CommandEnv = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  LIKES_KV: KVNamespace;
};

export type Command = {
  name: string;
  description: string;
  execute: (env: CommandEnv, update: TgUpdate) => Promise<void>;
};

/**
 * Єдиний реєстр текстових команд.
 * Порядок у цьому масиві = порядок показу в /help.
 */
export const commandsList: Command[] = [
  startCommand,
  helpCommand,
  pingCommand,
  echoCommand,
  menuCommand,
  likesCommand,
  statsCommand,
  wikiCommand,
  healthCommand,
];

/** Доступ по імені (для роутера) */
export const commandsByName: Record<string, Command> = Object.fromEntries(
  commandsList.map((c) => [c.name, c])
);

/** Зручний даункаст для отримання короткої довідки */
export function getCommandsInfo() {
  return commandsList.map((c) => ({ name: c.name, description: c.description }));
}