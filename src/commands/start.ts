// src/commands/start.ts
import { sendMessage } from "../telegram/api";

export async function cmdStart(chatId: number | string) {
  await sendMessage(
    chatId,
    "👋 Привіт! Бот підключено до Cloudflare Workers. Напишіть /help для довідки."
  );
}