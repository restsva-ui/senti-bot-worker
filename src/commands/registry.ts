// src/commands/registry.ts
import type { TgUpdate } from "../types";

/* Іменовані експорти з файлів команд (усі — const ...Command) */
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

/** Type-guard: валідний об'єкт команди */
function isCommandDef(x: any): x is Command {
  return !!x && typeof x.name === "string" && typeof x.description === "string" && typeof x.execute === "function";
}

/** Єдиний список команд (порядок = порядок у /help) */
const rawList = [
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

/** Фінальний список (прибирає undefined/невалідні) */
export const commandsList: Command[] = rawList.filter(isCommandDef);

/** Індекс за ім'ям — для роутера */
export const commandsByName: Record<string, Command> = Object.fromEntries(
  commandsList.map((c) => [c.name, c])
);

/** Довідка для /help */
export function getCommandsInfo() {
  return commandsList.map((c) => ({ name: c.name, description: c.description }));
}