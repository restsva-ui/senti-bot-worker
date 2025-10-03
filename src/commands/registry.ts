// src/commands/registry.ts
// Єдиний реєстр команд (для сумісності)

type Handler = (ctx: any, args?: any) => Promise<any> | any;

// ---- Імпорти команд ----
import { ping } from "./ping";

// AI — опційно, якщо існує файл ./ai
let ai: Handler | undefined;
try {
  // @ts-ignore — динамічний імпорт, якщо файла нема — зловимо в catch
  const { ai: aiExport } = await import("./ai");
  ai = aiExport as Handler | undefined;
} catch {
  ai = undefined;
}

// ---- Базовий набір без слеша ----
const base: Record<string, Handler> = { ping };

// Додаємо версії з префіксом "/"
const withSlash = Object.fromEntries(Object.entries(base).map(([k, v]) => ["/" + k, v]));

// Якщо AI є — додаємо обидві форми
if (ai) {
  (base as any).ai = ai;
  (withSlash as any)["/ai"] = ai;
}

// Експортуємо єдину мапу
export const COMMANDS: Record<string, Handler> = { ...base, ...withSlash };

// Утиліти (залишаємо, якщо десь використовується)
export function pickHandler(name: string): Handler | undefined {
  return (COMMANDS as any)[name];
}
export function hasCommand(name: string): boolean {
  return typeof (COMMANDS as any)[name] === "function";
}