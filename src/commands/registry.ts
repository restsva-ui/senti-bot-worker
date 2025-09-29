// src/commands/registry.ts
import type { TgUpdate } from "../types";

/** Уніфіковане оточення команд */
export type CommandEnv = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  LIKES_KV?: KVNamespace;
};

/** Сигнатура команди */
export type Command = {
  name: string;
  description: string;
  execute: (env: CommandEnv, update: TgUpdate) => Promise<void>;
};

/* ------------ Імпорти команд ------------ */
import { startCommand } from "./start";
import { pingCommand } from "./ping";
import { echoCommand } from "./echo";
import { menuCommand } from "./menu";
import { likesCommand } from "./likes";
import { statsCommand } from "./stats";
import { wikiCommand } from "./wiki";
import { helpCommand } from "./help";
import { healthCommand } from "./health";

/* ------------ Реєстр команд ------------ */
export const commands: Command[] = [
  startCommand,
  pingCommand,
  echoCommand,
  menuCommand,
  likesCommand,
  statsCommand,
  wikiCommand,
  helpCommand,
  healthCommand,
];

/** Індекс за назвою (для роутера) */
export const commandsByName: Record<string, Command> = Object.fromEntries(
  commands.map((c) => [c.name, c])
);

/** Коротка довідка (для /help) */
export function getCommandsInfo(): Array<{ name: string; description: string }> {
  return commands.map((c) => ({ name: c.name, description: c.description }));
}