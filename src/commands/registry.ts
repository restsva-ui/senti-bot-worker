// src/commands/registry.ts
import type { Command } from "./types";
import { startCommand } from "./start";
import { helpCommand } from "./help";
import { healthCommand } from "./health";
import { pingCommand } from "./ping";

// Якщо ці файли є у проєкті — можеш також додати:
// import { wikiCommand } from "./wiki";
// import { likesCommand, likesStatsCommand } from "./likes";
// import { menuCommand } from "./menu";

const commands: Command[] = [
  startCommand,
  helpCommand,
  healthCommand,
  pingCommand,
  // wikiCommand,
  // likesCommand,
  // likesStatsCommand,
  // menuCommand,
];

/** Пошук команди за ім’ям/аліасом (використовується у router) */
export function findCommandByName(name: string): Command | undefined {
  return commands.find(
    (c) => c.name === name || (c.aliases && c.aliases.includes(name))
  );
}

/** Стисла інфа для /help (ім’я + опис) */
export function getCommandsInfo() {
  return commands.map((c) => ({
    name: c.name,
    description: c.description ?? "",
  }));
}