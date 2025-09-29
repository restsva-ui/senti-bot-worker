// src/router/commandRouter.ts
import type { TgUpdate } from "../types";
import { findCommandByName } from "../commands/registry";
import { menuCanHandleCallback, menuOnCallback } from "../commands/menu";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string; OWNER_ID?: string };

// Витягує текст повідомлення чи підпису (для фото/відео)
function getMessageText(update: TgUpdate): string | undefined {
  const msg = update.message ?? update.edited_message;
  return (msg?.text ?? msg?.caption ?? undefined)?.trim();
}

export async function commandRouter(env: Env, update: TgUpdate) {
  // 1) Callback кнопок нашого меню
  const cb = update.callback_query;
  if (cb?.data && menuCanHandleCallback(cb.data)) {
    await menuOnCallback(env, update);
    return new Response("OK");
  }

  // 2) Текстові/командні повідомлення
  const text = getMessageText(update);
  if (!text) return new Response("NO_CONTENT");

  // Команди виду "/name ..." або "/name@bot ..."
  if (text.startsWith("/")) {
    const cmdName = text.split(/\s+/, 1)[0]!.slice(1); // без '/'
    const cmd = findCommandByName(cmdName);
    if (cmd?.execute) {
      await cmd.execute(env as any, update);
      return new Response("OK");
    }
  }

  // 3) Фолбек — нічого не робимо
  return new Response("IGNORED");
}