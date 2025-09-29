// src/commands/registry.ts
// Єдиний реєстр команд із безпечними імпортами (працює і з default, і з named).
// Експортує іменований об'єкт COMMANDS, щоб index.ts міг імпортувати: { COMMANDS }.
// Також даємо допоміжні pickHandler / hasCommand — якщо десь використовуються.

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

// Wiki — наші нові іменовані експорти
import wikiDefault, {
  wiki as wikiExport,
  wikiSetAwait,
  wikiMaybeHandleFreeText,
} from "./wiki";
const wiki: Handler = (wikiExport as any) ?? (wikiDefault as any);

// AI (може бути відключений змінною середовища, але в реєстрі лишимо)
import aiNamed, { ai as aiExport } from "./ai";
const ai: Handler | undefined = (aiExport as any) ?? (aiNamed as any);

// Карта доступних команд (імена рівно такі, як ви очікуєте у /help)
export const COMMANDS: Record<string, Handler> = {
  start,
  help,
  ping,
  health,
  wiki,
  // додаткові службові "не командні", але корисні в роутингу:
  // їх НЕ оголошуємо як видимі команди, проте експортуємо окремо нижче
};

// Окремо експортуємо wiki-сервісні хелпери (потрібні іншим місцям)
export { wikiSetAwait, wikiMaybeHandleFreeText };

// AI команду додаємо акуратно: якщо файл є — вона в реєстрі, якщо ні — ні.
if (ai) {
  (COMMANDS as any).ai = ai;
}

// Дрібні утиліти (можуть використовуватись у index.ts або інших частинах)
export function pickHandler(name: string): Handler | undefined {
  return (COMMANDS as any)[name];
}

export function hasCommand(name: string): boolean {
  return typeof (COMMANDS as any)[name] === "function";
}