// src/commands/registry.ts
// Реєстр команд + утиліти пошуку/ввімкнення AI

type Handler = (ctx: any, args?: any) => Promise<any> | any;

// Безпечні імпорти (named || default)
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

// AI може бути відключений
import aiNamed, { ai as aiExport } from "./ai";
const aiHandler: Handler | undefined = (aiExport as any) ?? (aiNamed as any);

// внутрішня мапа
const MAP: Record<string, Handler> = {
  start,
  help,
  ping,
  health,
  wiki,
};

// керування AI-видимістю
export function attachAI(enabled: boolean) {
  if (enabled && aiHandler) MAP.ai = aiHandler;
  else delete MAP.ai;
}

// пошук хендлера
export function findCommandByName(name: string): Handler | undefined {
  return MAP[name];
}

// (опційно) віддати список видимих команд — зручно для /help
export function listVisible(): string[] {
  return Object.keys(MAP);
}

// реекспорт wiki-хелперів, якщо десь потрібні
export { wikiSetAwait, wikiMaybeHandleFreeText };