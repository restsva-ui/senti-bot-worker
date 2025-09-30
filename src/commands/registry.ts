// src/commands/registry.ts
// Єдиний реєстр. Повертає мапу команд та дає findCommandByName.
// Уніфікована сигнатура виклику команд: (env, update).

import type { TgUpdate } from "../types";
import type { TgEnv } from "../utils/telegram";

// Імпорти команд (ми їх лагодитимемо на етапі 2)
import start from "./start";
import help from "./help";
import ping from "./ping";
import wiki from "./wiki";
// ai підʼєднаємо тільки коли AI_ENABLED=true і файл не зламаний
let ai: ((env: TgEnv, update: TgUpdate) => Promise<void>) | undefined;
try {
  // @ts-ignore
  const mod = await import("./ai");
  ai = (mod.ai ?? mod.default) as any;
} catch (_) {
  ai = undefined;
}

export type CommandFn = (env: TgEnv, update: TgUpdate) => Promise<void>;

const REGISTRY = new Map<string, CommandFn>();

function register(name: string, fn: any) {
  if (typeof fn === "function") REGISTRY.set(name, fn as CommandFn);
}

// базовий набір
register("start", start);
register("help", help);
register("ping", ping);
register("wiki", wiki);

// умовно додаємо ai
export function attachAI(enabled: boolean) {
  if (enabled && ai) REGISTRY.set("ai", ai as CommandFn);
  else REGISTRY.delete("ai");
}

export function getCommands(): Map<string, CommandFn> {
  return REGISTRY;
}

export function findCommandByName(name: string): CommandFn | undefined {
  return REGISTRY.get(name.toLowerCase());
}