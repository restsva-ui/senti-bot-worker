// src/router/commandRouter.ts
import type { TgUpdate } from "../types";
import { findCommandByName } from "../commands/registry";
import { menuCanHandleCallback, menuOnCallback } from "../commands/menu";
import { likesCanHandleCallback, likesOnCallback } from "../commands/likes";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV?: unknown };

function getMessageText(update: TgUpdate): string | undefined {
  const msg = update.message ?? update.edited_message;
  const text = msg?.text ?? msg?.caption;
  return typeof text === "string" ? text.trim() : undefined;
}

export async function commandRouter(env: Env, update: TgUpdate) {
  // 1) Спочатку обробляємо callback_data (лайки → меню)
  const cb = update.callback_query;
  if (cb?.data) {
    if (likesCanHandleCallback(cb.data)) {
      await likesOnCallback(env as any, update);
      return new Response("OK");
    }
    if (menuCanHandleCallback(cb.data)) {
      await menuOnCallback(env as any, update);
      return new Response("OK");
    }
  }

  // 2) Текстові повідомлення / команди
  const text = getMessageText(update);
  if (!text) return new Response("NO_CONTENT");

  if (text.startsWith("/")) {
    const cmdToken = text.split(/\s+/, 1)[0]!.slice(1); // відкидаємо '/'
    const cmd = findCommandByName(cmdToken); // усередині зрізається @botname
    if (cmd?.execute) {
      await cmd.execute(env as any, update);
      return new Response("OK");
    }
  }

  return new Response("IGNORED");
}

// Псевдонім для зворотної сумісності з src/index.ts
export const routeUpdate = commandRouter;