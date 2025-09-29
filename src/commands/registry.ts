// src/commands/registry.ts
import type { TgUpdate } from "../types";

import { startCommand } from "./start";
import { pingCommand } from "./ping";
import { echoCommand } from "./echo";
import { helpCommand } from "./help";
import { healthCommand } from "./health";
import { menuCommand } from "./menu";
import { wikiCommand } from "./wiki";

// Лайки (+ статистика). ВАЖЛИВО: у likes.ts мають бути обидва експорти.
import { likesCommand, likesStatsCommand } from "./likes";

export const COMMANDS = [
  startCommand,
  pingCommand,
  healthCommand,
  helpCommand,
  menuCommand,
  echoCommand,
  wikiCommand,
  likesCommand,
  likesStatsCommand,
] as const;

export type Command = (typeof COMMANDS)[number];

export function findCommandByName(name: string): Command | undefined {
  const pure = name.split("@")[0]; // на випадок /cmd@botname
  return COMMANDS.find(c => c.name === pure);
}

export function getCommandsInfo() {
  return COMMANDS.map(c => ({ name: c.name, description: c.description }));
}