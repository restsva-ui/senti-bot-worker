import type { TgUpdate } from "../types";
import { findCommandByName } from "../commands/registry";
import { menuCanHandleCallback, menuOnCallback } from "../commands/menu";
import { likesCanHandleCallback, likesOnCallback } from "../commands/likes";
import { wikiMaybeHandleFreeText } from "../commands/wiki";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV?: any };

function getMessageText(update: TgUpdate): string | undefined {
  const msg = update.message ?? update.edited_message;
  return (msg?.text ?? msg?.caption ?? undefined)?.trim();
}

export async function commandRouter(env: Env, update: TgUpdate) {
  // 1) Callback-и (спочатку лайки, потім меню)
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

  // 2) Вільний текст після prompt'у Wiki (force_reply)
  if (update.message) {
    const handled = wikiMaybeHandleFreeText(env as any, update);
    if (handled) return new Response("OK");
  }

  // 3) Команди
  const text = getMessageText(update);
  if (!text) return new Response("NO_CONTENT");

  if (text.startsWith("/")) {
    const cmdToken = text.split(/\s+/, 1)[0]!.slice(1); // без '/'
    const cmd = findCommandByName(cmdToken);
    if (cmd?.execute) {
      await cmd.execute(env as any, update);
      return new Response("OK");
    }
  }

  return new Response("IGNORED");
}

// Псевдонім для зворотної сумісності з src/index.ts
export const routeUpdate = commandRouter;