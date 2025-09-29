// src/commands/registry.ts
import { start } from "./start";
import { help } from "./help";
import { ping } from "./ping";
import { health } from "./health";
import { wiki, wikiSetAwait, wikiMaybeHandleFreeText } from "./wiki";
import { ai } from "./ai"; // ⬅️ нове

type Env = { AI_ENABLED?: string };

export type CommandHandler = (update: any, env: any) => Promise<void>;

export function getCommands(env: Env): Map<string, CommandHandler> {
  const map = new Map<string, CommandHandler>();

  map.set("start", start);
  map.set("help", help);
  map.set("ping", ping);
  map.set("health", health);
  map.set("wiki", wiki);

  // умовно підключаємо /ai
  if (String(env.AI_ENABLED).toLowerCase() === "true") {
    map.set("ai", ai);
  }

  return map;
}

// (за наявності у тебе цих хелперів — не прибираємо)
export { wikiSetAwait, wikiMaybeHandleFreeText };