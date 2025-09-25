import { sendMessage } from "../telegram/api";

export async function ping(chatId: string | number) {
  await sendMessage(chatId, "pong ✅");
}