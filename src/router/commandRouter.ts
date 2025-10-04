// src/router/commandRouter.ts
import type { TgUpdate } from "../types";
import { tgSendMessage } from "../utils/telegram";
import { menuCanHandleCallback, menuOnCallback } from "../commands/menu";
import { likesCanHandleCallback, likesOnCallback } from "../commands/likes";
import { wikiSummary } from "../wiki";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV?: any };

function getMessageText(update: TgUpdate): string | undefined {
  const msg = update.message ?? update.edited_message;
  return (msg?.text ?? msg?.caption ?? undefined)?.trim();
}

function normalizeCmdToken(raw: string) {
  return raw.replace(/^\/([a-zA-Z0-9_]+)(?:@\w+)?$/, "$1").toLowerCase();
}

export async function commandRouter(request: Request, env: Env): Promise<Response> {
  const update: TgUpdate = await request.json();

  // 1) callback_query (кнопки)
  const cb = (update as any)?.callback_query;
  if (cb?.id) {
    const data: string | undefined = cb?.data ?? undefined;

    if (likesCanHandleCallback(data)) {
      await likesOnCallback(env as any, update as any);
      return new Response("OK");
    }
    if (data?.startsWith("menu:") || data?.startsWith("settings:")) {
      await menuOnCallback(env as any, update as any);
      return new Response("OK");
    }
    const chatId = cb?.message?.chat?.id;
    if (chatId) await tgSendMessage(env as any, chatId, `tap: ${data ?? ""}`);
    return new Response("OK");
  }

  // 2) звичайне повідомлення/команда
  const text = getMessageText(update) || "";
  const chatId = (update.message ?? update.edited_message)?.chat?.id;

  if (!chatId || !text) return new Response("IGNORED");

  // команди
  if (/^\/\w+/.test(text)) {
    const token = normalizeCmdToken(text.split(/\s+/)[0]);

    if (token === "ping") {
      await tgSendMessage(env as any, chatId, "pong");
      return new Response("OK");
    }
    if (token === "menu") {
      // простий пінг меню (деталізоване меню в основному воркері)
      await tgSendMessage(env as any, chatId, "Меню відкрито (демо роутер)");
      return new Response("OK");
    }
    if (token === "likes") {
      // делегуємо в likes
      await likesOnCallback(env as any, update as any);
      return new Response("OK");
    }
    if (token === "wiki") {
      const q = text.replace(/^\/wiki(?:@\w+)?\s*/i, "").trim() || "Україна";
      try {
        const s = await wikiSummary(q, "uk");
        await tgSendMessage(env as any, chatId, s);
      } catch (e: any) {
        await tgSendMessage(env as any, chatId, `wiki: ${e?.message || "помилка"}`);
      }
      return new Response("OK");
    }

    // fallback для невідомих команд
    await tgSendMessage(env as any, chatId, "Команда не підтримується цим роутером.");
    return new Response("OK");
  }

  // 3) вільний текст → пробуємо wiki-хендлер після "/wiki ..."
  if (/^wiki\s+/i.test(text)) {
    const q = text.replace(/^wiki\s+/i, "").trim();
    try {
      const s = await wikiSummary(q, "uk");
      await tgSendMessage(env as any, chatId, s);
    } catch (e: any) {
      await tgSendMessage(env as any, chatId, `wiki: ${e?.message || "помилка"}`);
    }
    return new Response("OK");
  }

  // 4) інакше — ігнор
  return new Response("IGNORED");
}

// зворотна сумісність
export const routeUpdate = commandRouter;