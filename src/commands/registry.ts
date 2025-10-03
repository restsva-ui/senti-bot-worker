// src/commands/registry.ts
type Handler = (ctx: any, args?: any) => Promise<any> | any;

import { ping } from "./ping";

// AI — опційно, якщо існує файл ./ai
let ai: Handler | undefined;
try {
  // @ts-ignore
  const { ai: aiExport } = await import("./ai");
  ai = aiExport as Handler | undefined;
} catch {
  ai = undefined;
}

const base: Record<string, Handler> = { ping };
const withSlash = Object.fromEntries(Object.entries(base).map(([k, v]) => ["/" + k, v]));
if (ai) {
  (base as any).ai = ai;
  (withSlash as any)["/ai"] = ai;
}

export const COMMANDS: Record<string, Handler> = { ...base, ...withSlash };
export const wikiSetAwait = undefined as unknown as never;          // більше не експортуємо
export const wikiMaybeHandleFreeText = undefined as unknown as never; // більше не експортуємо

export function pickHandler(name: string): Handler | undefined {
  return (COMMANDS as any)[name];
}
export function hasCommand(name: string): boolean {
  return typeof (COMMANDS as any)[name] === "function";
}