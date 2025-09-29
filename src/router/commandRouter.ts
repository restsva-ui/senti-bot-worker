// src/router/commandRouter.ts
import type { TgUpdate } from "../types";
import type { CommandEnv } from "../commands/registry";
import { commandsByName } from "../commands/registry";
import { menuCanHandleCallback, menuOnCallback } from "../commands/menu";
import { likesCanHandleCallback, likesOnCallback } from "../commands/likes";

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

    if (menuCanHandleCallback(data)) {
      await menuOnCallback(env, update);
      return;
    }
    if (likesCanHandleCallback(data)) {
      await likesOnCallback(env, update);
      return;
    }
    return; // невідомий callback — ігноруємо
  }

  // 2) Текстові команди
  const msg = (update as any).message;
  const text: string = msg?.text ?? "";
  for (const name of Object.keys(commandsByName)) {
    if (isCommand(text, name)) {
      await commandsByName[name].execute(env, update);
      return;
    }
  }
  // Невідома команда — тиша, OK поверне index.ts
}