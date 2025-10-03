// src/commands/menu.ts
// Мінімалістичне меню: без кнопок. Лише підказка, що робити.

import { tgSendMessage } from "../utils/telegram";
import type { Env } from "../index";

export async function menuCommand(env: Env, chatId: number) {
  const text =
    "📍 Мінімальне меню\n\n" +
    "Просто надсилай повідомлення (я відповім контекстно) або використовуй команди:\n" +
    "• /ask <текст>\n" +
    "• /ping /likes /stats /help";
  await tgSendMessage(env as any, chatId, text);
}

// Лишаємо заглушку на випадок, якщо десь залишаться callback-и.
export async function menuOnCallback(env: Env, update: any) {
  const chatId = update?.callback_query?.message?.chat?.id;
  if (!chatId) return;
  await tgSendMessage(env as any, chatId, "Меню без кнопок. Скористайся /menu або /help.");
}