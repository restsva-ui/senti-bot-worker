// src/commands/registry.ts
import { startCommand } from "./start";
import { helpCommand } from "./help";
import { wikiCommand } from "./wiki";           // ← важливо
import { pingCommand } from "./ping";
import { healthCommand } from "./health";

export const COMMANDS: Record<string, Function> = {
  start: startCommand,
  help: helpCommand,
  wiki: wikiCommand,                            // ← підключено
  ping: pingCommand,
  health: healthCommand,
};

// короткий список у меню
export function getCommandsInfo() {
  return [
    { command: "help", description: "Довідка" },
    { command: "wiki", description: "Пошук у Вікіпедії" },
  ];
}