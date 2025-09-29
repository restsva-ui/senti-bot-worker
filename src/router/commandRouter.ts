// src/router/commandRouter.ts
import type { TgUpdate } from "../types";

/* Команди */
import { startCommand } from "../commands/start";
import { pingCommand } from "../commands/ping";
import { healthCommand } from "../commands/health";
import { helpCommand } from "../commands/help";
import { wikiCommand } from "../commands/wiki";

/** Мінімальний контракт середовища, потрібний командам */
export type CommandEnv = {
  BOT_TOKEN: string;
  API_BASE_URL?: string;
  LIKES_KV: KVNamespace; // для команд, що потребують KV
};

/** Опис команди */
type Command = {
  name: string;
  description: string;
  execute: (env: CommandEnv, update: TgUpdate) => Promise<void>;
};

/** Реєстр команд */
const commands: Record<string, Command> = {
  [startCommand.name]: startCommand,
  [pingCommand.name]: pingCommand,
  [healthCommand.name]: healthCommand,
  [helpCommand.name]: helpCommand,
  [wikiCommand.name]: wikiCommand,
};

/** Перевірка, чи текст є викликом конкретної команди */
function isCommand(msgText: string | undefined, name: string) {
  const t = msgText ?? "";
  const re = new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s|$)`, "i");
  return re.test(t);
}

/** Головна функція роутера команд */
export async function routeUpdate(env: CommandEnv, update: TgUpdate): Promise<void> {
  const msg = update.message;
  const text = msg?.text ?? "";

  for (const key of Object.keys(commands)) {
    if (isCommand(text, key)) {
      await commands[key].execute(env, update);
      return;
    }
  }

  // Якщо команда не впізнана — свідомо нічого не робимо (тихий OK у index.ts)
}