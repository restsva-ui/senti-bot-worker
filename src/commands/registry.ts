import { wikiCommand } from "./wiki";
import { helpCommand } from "./help";
import { healthCommand } from "./health";
// ...

const commands = [
  wikiCommand,
  helpCommand,
  healthCommand,
  // тут має бути startCommand
];

export function findCommandByName(name: string) {
  return commands.find(c => c.name === name || c.aliases?.includes(name));
}