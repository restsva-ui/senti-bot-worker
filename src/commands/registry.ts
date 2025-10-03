// src/commands/registry.ts
// Єдиний реєстр команд. Даємо ключі і з префіксом "/", і без.

type Handler = (ctx: any, args?: any) => Promise<any> | any;

// ---- Імпорти команд ----
import { ping } from "./ping";

import {
  wiki as wikiExport,
  wikiSetAwait,
  wikiMaybeHandleFreeText,
} from "./wiki";

// AI (опціонально)
import { ai as aiExport } from "./ai";

// ---- Базовий набір без слеша ----
const base: Record<string, Handler> = {
  ping,
  wiki: wikiExport as Handler,
};

// Додаємо версії з префіксом "/"
const withSlash = Object.fromEntries(
  Object.entries(base).map(([k, v]) => ["/" + k, v])
);

// Якщо AI є — додаємо обидві форми
if (aiExport) {
  (base as any).ai = aiExport;
  (withSlash as any)["/ai"] = aiExport;
}

// Експортуємо єдину мапу, що містить ключі і з "/", і без
export const COMMANDS: Record<string, Handler> = {
  ...base,
  ...withSlash,
};

// Експортуємо wiki-хелпери
export { wikiSetAwait, wikiMaybeHandleFreeText };

// Утиліти
export function pickHandler(name: string): Handler | undefined {
  return (COMMANDS as any)[name];
}
export function hasCommand(name: string): boolean {
  return typeof (COMMANDS as any)[name] === "function";
}
