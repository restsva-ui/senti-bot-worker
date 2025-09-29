// src/commands/registry.ts
import { startCommand } from "./start";
import { pingCommand } from "./ping";
import { healthCommand } from "./health";
import { helpCommand } from "./help";
import { echoCommand } from "./echo";
import { likesCommand, likesStatsCommand } from "./likes";
import { menuCommand } from "./menu";
import { wikiCommand } from "./wiki";

export const commands = [
  startCommand,
  pingCommand,
  healthCommand,
  helpCommand,
  echoCommand,
  likesCommand,
  likesStatsCommand,
  menuCommand,
  wikiCommand,
] as const;

export type Command = (typeof commands)[number];

export function findCommandByName(name: string): Command | undefined {
  const n = name.replace(/^\/+/, "").split("@")[0].toLowerCase();
  return (commands as readonly any[]).find((c) => c.name === n);
}

export function getCommandsInfo() {
  return commands.map((c) => ({
    name: c.name as string,
    description: (c.description as string) ?? "",
  }));
}