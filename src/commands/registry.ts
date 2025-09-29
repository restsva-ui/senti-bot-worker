// src/commands/registry.ts
import type { Command } from "./types";
import { startCommand } from "./start";
import { helpCommand } from "./help";
import { healthCommand } from "./health";
import { wikiCommand } from "./wiki";
import { pingCommand } from "./ping";
// якщо є ще menu / likes, можна теж додати

const commands: Command[] = [
  startCommand,
  helpCommand,
  healthCommand,
  wikiCommand,
  pingCommand,
];

export function findCommandByName(name: string): Command | undefined {
  return commands.find(
    (c) => c.name === name || (c.aliases && c.aliases.includes(name))
  );
}

// те, чого бракувало — для /help
export function getCommandsInfo() {
  return commands.map((c) => ({
    name: c.name,
    description: c.description ?? "",
  }));
}