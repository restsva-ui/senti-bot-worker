// src/router/commandRouter.ts
/* --------------------------- Types & Imports --------------------------- */
import type { Env } from "../config";
import type { TgUpdate } from "../types";

/* Команди */
import { startCommand } from "../commands/start";
import { pingCommand } from "../commands/ping";
import { healthCommand } from "../commands/health";
import { helpCommand } from "../commands/help";
import { menuCommand } from "../commands/menu";
import { echoCommand } from "../commands/echo";
import { likesCommand, likesCanHandleCallback, likesOnCallback } from "../commands/likes";
import { statsCommand } from "../commands/stats";
import { wikiCommand } from "../commands/wiki";

/* --------------------------- Utils ------------------------------------ */
function isCommand(msgText: string | undefined, name: string) {
  const t = msgText ?? "";
  const re = new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s|$)`, "i");
  return re.test(t);
}

/* --------------------------- Registry --------------------------------- */
type Command = {
  name: string;
  description: string;
  execute: (env: Env, update: TgUpdate) => Promise<void>;
};

const commands: Record<string, Command> = {
  [startCommand.name]: startCommand,
  [pingCommand.name]: pingCommand,
  [healthCommand.name]: healthCommand,
  [helpCommand.name]: helpCommand,
  [menuCommand.name]: menuCommand,
  [echoCommand.name]: echoCommand,
  [likesCommand.name]: likesCommand,
  [statsCommand.name]: statsCommand,
  [wikiCommand.name]: wikiCommand,
};

/* --------------------------- Router ----------------------------------- */
/**
 * Головний роутер апдейтів Telegram.
 * – Команди з тексту обробляються за префіксом /<cmd>
 * – callback_query обробляємо лише для лайків
 */
export async function handleUpdate(env: Env, update: TgUpdate): Promise<void> {
  // 1) callback_query (inline-кнопки)
  if (update.callback_query) {
    const cb = update.callback_query;
    const data = cb.data ?? "";

    // Лишаємо тільки лайки
    if (likesCanHandleCallback(data)) {
      await likesOnCallback(env as any, update);
    }
    return;
  }

  // 2) Текстові команди
  const msg = update.message;
  const text = msg?.text ?? "";
  if (!text) return;

  for (const key of Object.keys(commands)) {
    if (isCommand(text, key)) {
      await commands[key].execute(env as any, update);
      return;
    }
  }

  // 3) Невідома команда — мовчимо
  return;
}

/* Сумісність з різними імпортами в проекті */
export { handleUpdate as routeUpdate, handleUpdate as commandRouter };