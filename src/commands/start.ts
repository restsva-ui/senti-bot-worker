import { sendMessage } from "../telegram/api";

export async function start(chatId: string | number) {
  await sendMessage(chatId, "👋 Привіт! Бот підключено до Cloudflare Workers.");
}