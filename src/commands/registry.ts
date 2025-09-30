// src/commands/registry.ts
// Єдиний реєстр команд. Даємо ключі і з префіксом "/", і без — щоб router завжди попав.

type Handler = (ctx: any, args?: any) => Promise<any> | any;

// ---- Безпечні імпорти (працює і з default, і з named) ----
import startNamed, { start as startExport } from "./start";
const start: Handler = (startExport as any) ?? (startNamed as any);

import helpNamed, { help as helpExport } from "./help";
const help: Handler = (helpExport as any) ?? (helpNamed as any);

import pingNamed, { ping as pingExport } from "./ping";
const ping: Handler = (pingExport as any) ?? (pingNamed as any);

import healthNamed, { health as healthExport } from "./health";
const health: Handler = (healthExport as any) ?? (healthNamed as any);

import wikiDefault, {
  wiki as wikiExport,
  wikiSetAwait,
  wikiMaybeHandleFreeText,
} from "./wiki";
const wiki: Handler = (wikiExport as any) ?? (wikiDefault as any);

// AI (може бути відключений змінною середовища)
import aiNamed, { ai as aiExport } from "./ai";
const ai: Handler | undefined = (aiExport as any) ?? (aiNamed as any);

// ---- Базовий набір без слеша ----
const base: Record<string, Handler> = {
  start,
  help,
  ping,
  health,
  wiki,
};

// Додаємо версії з префіксом "/"
const withSlash = Object.fromEntries(
  Object.entries(base).map(([k, v]) => ["/" + k, v])
);

// Якщо AI є — додаємо обидві форми
if (ai) {
  (base as any).ai = ai;
  (withSlash as any)["/ai"] = ai;
}

// Експортуємо єдину мапу, що містить ключі і з "/", і без
export const COMMANDS: Record<string, Handler> = {
  ...base,
  ...withSlash,
};

// Виносимо wiki-хелпери
export { wikiSetAwait, wikiMaybeHandleFreeText };

// Утиліти (на випадок якщо десь юзаються)
export function pickHandler(name: string): Handler | undefined {
  return (COMMANDS as any)[name];
}
export function hasCommand(name: string): boolean {
  return typeof (COMMANDS as any)[name] === "function";
}