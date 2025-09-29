// src/router/commandRouter.ts
import type { TgUpdate } from "../types";

/* Команди */
import { startCommand } from "../commands/start";
import { pingCommand } from "../commands/ping";
import { healthCommand } from "../commands/health";
import { helpCommand } from "../commands/help";
import { wikiCommand } from "../commands/wiki";
import { echoCommand } from "../commands/echo";
import { menuCommand, menuCanHandleCallback, menuOnCallback } from "../commands/menu";

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

/** Реєстр команд (тільки для текстових повідомлень/команд) */
const commands: Record<string, Command> = {
  [startCommand.name]: startCommand,
  [pingCommand.name]: pingCommand,
  [healthCommand.name]: healthCommand,
  [helpCommand.name]: helpCommand,
  [wikiCommand.name]: wikiCommand,
  [echoCommand.name]: echoCommand,
  [menuCommand.name]: menuCommand,
};

/** Перевірка, чи текст є викликом конкретної команди */
function isCommand(msgText: string | undefined, name: string) {
  const t = msgText ?? "";
  const re = new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s|$)`, "i");
  return re.test(t);
}

/** Головна функція роутера команд/кнопок */
export async function routeUpdate(env: CommandEnv, update: TgUpdate): Promise<void> {
  // 1) callback_query (inline-кнопки)
  const cq: any = (update as any).callback_query;
  if (cq?.data) {
    const data: string = cq.data;

    // Меню
    if (menuCanHandleCallback(data)) {
      await menuOnCallback(env, update);
      return;
    }

    // Інші модулі з callback'ами можна підключати аналогічно ↑
    return;
  }

  // 2) Текстові команди
  const msg = (update as any).message;
  const text: string = msg?.text ?? "";

  for (const key of Object.keys(commands)) {
    if (isCommand(text, key)) {
      await commands[key].execute(env, update);
      return;
    }
  }

  // Якщо команда не впізнана — свідомо нічого не робимо (тихий OK у index.ts)
}