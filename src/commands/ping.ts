// src/commands/ping.ts
import { tgSendMessage } from "../utils/telegram";

export async function handlePing(env: any, chatId: number) {
  // Відповідь на команду /ping
  await tgSendMessage(env, chatId, "pong ✅");
}