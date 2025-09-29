// src/commands/registry.ts
import { startCommand } from "./start";
import { pingCommand } from "./ping";
import { healthCommand } from "./health";
import { helpCommand } from "./help";
import { menuCommand } from "./menu";
import { echoCommand } from "./echo";
import { likesCommand } from "./likes";
import { statsCommand } from "./stats";
import { wikiCommand } from "./wiki";

export type Command = {
  name: string;
  description: string;
  execute: (...args: any[]) => Promise<void>;
};

// Збираємо всі команди в масив
export const allCommands: Command[] = [
  startCommand,
  pingCommand,
  healthCommand,
  helpCommand,
  menuCommand,
  echoCommand,
  likesCommand,
  statsCommand,
  wikiCommand,
].filter((cmd): cmd is Command => Boolean(cmd && cmd.name && cmd.execute));

// Допоміжна функція для /help
export function getCommandsInfo() {
  return allCommands.map((c) => ({
    name: c.name,
    description: c.description,
  }));
}