// src/router/commandRouter.ts
import type { TgUpdate } from "../types";
import { findCommandByName } from "../commands/registry";
import { menuCanHandleCallback, menuOnCallback } from "../commands/menu";
import { likesCanHandleCallback, likesOnCallback } from "../commands/likes";
import { aiMaybeHandleFreeText } from "../commands/ai";
import { wikiMaybeHandleFreeText } from "../commands/wiki";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV?: any };

/** Дістаємо текст із message/edited_message */
function getMessageText(update: TgUpdate): string | undefined {
  const msg = update.message ?? update.edited_message;
  return (msg?.text ?? msg?.caption ?? undefined)?.trim();
}

/** Нормалізуємо токен команди: "/cmd@BotName" -> "cmd" */
function normalizeCmdToken(raw: string): string {
  return raw.replace(/^\/+/, "").split("@", 1)[0].toLowerCase();
}

export async function commandRouter(env: Env, update: TgUpdate) {
  // 0) Діагностика
  try {
    console.log("update:", JSON.stringify(update));
  } catch {}

  // 1) Callback-и: спочатку лайки, потім меню
  const cb = update.callback_query;
  if (cb?.data) {
    const data = cb.data;
    if (likesCanHandleCallback(data)) {
      await likesOnCallback(env as any, update);
      return new Response("OK");
    }
    if (menuCanHandleCallback(data)) {
      await menuOnCallback(env as any, update);
      return new Response("OK");
    }
    // інші callback-и ігноруємо
    return new Response("IGNORED_CB");
  }

  // 2) Текст/команди
  const text = getMessageText(update);
  if (!text) return new Response("NO_CONTENT");

  if (text.startsWith("/")) {
    // /cmd або /cmd@BotName [+ аргументи]
    const firstToken = text.split(/\s+/, 1)[0]!;
    const cmdName = normalizeCmdToken(firstToken);

    const cmd = findCommandByName(cmdName);
    if (cmd) {
      try {
        await cmd(update as any, env as any);
      } catch (e) {
        console.error(`Command '${cmdName}' failed:`, e);
      }
      return new Response("OK");
    }

    console.warn("Unknown command:", cmdName);
    return new Response("UNKNOWN_CMD");
  }

  // 3) Не команда — даємо шанс AI-потоку з’їсти “вільний текст” після /ai
  try {
    const handledAI = await aiMaybeHandleFreeText(update as any, env as any);
    if (handledAI) return new Response("OK");
  } catch (e) {
    console.warn("ai free-text error:", e);
  }

  // 4) Якщо не AI — даємо шанс Wiki-потоку на “вільний текст” після /wiki
  try {
    const handledWiki = await wikiMaybeHandleFreeText(update as any, env as any);
    if (handledWiki) return new Response("OK");
  } catch (e) {
    console.warn("wiki free-text error:", e);
  }

  // 5) Інакше — ігноруємо
  return new Response("IGNORED");
}

// Зворотна сумісність із старими імпортами
export const routeUpdate = commandRouter;