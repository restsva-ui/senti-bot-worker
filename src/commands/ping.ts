import { sendMessage } from "../telegram/api";
export async function cmdPing(chatId: number) {
  await sendMessage(chatId, "pong ✅");
}