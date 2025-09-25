import { sendMessage } from "../telegram/api";
export async function cmdPing(chatId: string|number) {
  await sendMessage(chatId, "pong ✅");
}