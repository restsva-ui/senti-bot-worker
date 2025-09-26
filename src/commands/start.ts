import { sendMessage } from "../telegram/api";

export async function cmdStart(chatId: number) {
  await sendMessage(
    chatId,
    "👋 Привіт! Бот підключено до Cloudflare Workers. Напишіть /help для довідки."
  );
}