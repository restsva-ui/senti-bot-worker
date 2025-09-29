// src/router/commandRouter.ts
import type { TgUpdate } from "../types";
import type { CommandEnv } from "../commands/registry";
import { commandsByName } from "../commands/registry";
import { menuCanHandleCallback, menuOnCallback } from "../commands/menu";
import { likesCanHandleCallback, likesOnCallback } from "../commands/likes";
import { wikiCommand } from "../commands/wiki"; // для спеціальної обробки ForceReply-відповіді

function isCommand(msgText: string | undefined, name: string) {
  const t = msgText ?? "";
  const re = new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s|$)`, "i");
  return re.test(t);
}

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
    return;
  }

  // 2) Текстові повідомлення
  const msg = (update as any).message;
  const text: string = msg?.text ?? "";

  // 2.1) Якщо це відповідь на наш ForceReply-запит для /wiki — обробляємо як /wiki <user text>
  const replied = msg?.reply_to_message;
  const isReplyToWikiPrompt =
    replied?.from?.is_bot === true &&
    typeof replied?.text === "string" &&
    replied.text.startsWith("🔎 Введіть запит для /wiki");

  if (isReplyToWikiPrompt) {
    // Синтезуємо виклик команди: "/wiki " + текст користувача
    const syntheticUpdate: TgUpdate = JSON.parse(JSON.stringify(update));
    (syntheticUpdate as any).message.text = `/wiki ${text}`;
    await wikiCommand.execute(env, syntheticUpdate);
    return;
  }

  // 2.2) Звичайні команди у форматі "/<name>"
  for (const name of Object.keys(commandsByName)) {
    if (isCommand(text, name)) {
      await commandsByName[name].execute(env, update);
      return;
    }
  }

  // Інакше — тихий OK (нічого не робимо)
}