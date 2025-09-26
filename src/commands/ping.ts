// src/commands/ping.ts
import { sendMessage } from "../telegram/api";

export async function cmdPing(chatId: number | string) {
  await sendMessage(chatId, "pong ✅");
}