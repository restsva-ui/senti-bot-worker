import type { TgUpdate } from "../types";
import { menuCommand } from "./menu";
import { likesCommand, likesStatsCommand } from "./likes";
import { wikiCommand } from "./wiki";

type Cmd = {
  name: string;
  description: string;
  execute(env: any, update: TgUpdate): Promise<void>;
};

export const commands: Cmd[] = [
  menuCommand,
  wikiCommand,
  likesCommand,
  likesStatsCommand,
];

export function findCommandByName(name: string) {
  return commands.find((c) => c.name === name);
}