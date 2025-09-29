import type { TgUpdate } from "../types";
import { findCommandByName } from "../commands/registry";
import { menuCanHandleCallback, menuOnCallback } from "../commands/menu";
import { likesCanHandleCallback, likesOnCallback } from "../commands/likes";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV?: any };

function getMessageText(update: TgUpdate): string | undefined {
  const msg = update.message ?? update.edited_message;
  return (msg?.text ?? msg?.caption ?? undefined)?.trim();
}

function normalizeCmd(token: string): string {
  // /cmd@botname -> cmd
  return token.replace(/^\/+/, "").split("@", 1)[0] || "";
}

export async function commandRouter(env: Env, update: TgUpdate) {
  // 0) Лог — бачимо, що саме прийшло
  console.log("update:", JSON.stringify(update));

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
    return new Response("IGNORED_CB");
  }

  // 2) Текст/команди
  const text = getMessageText(update);
  if (!text) return new Response("NO_CONTENT");

  if (text.startsWith("/")) {
    const cmdToken = text.split(/\s+/, 1)[0]!;
    const cmdName = normalizeCmd(cmdToken);
    const cmd = findCommandByName(cmdName);

    if (!cmd) {
      console.warn("Unknown command:", cmdName);
      return new Response("UNKNOWN_CMD");
    }

    try {
      await cmd.execute(env as any, update);
    } catch (e) {
      console.error(`Command '${cmdName}' failed:`, e);
    }
    return new Response("OK");
  }

  return new Response("IGNORED");
}

// Псевдонім для зворотної сумісності
export const routeUpdate = commandRouter;