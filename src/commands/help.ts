import { sendMessage } from "../utils/telegram";
import type { Env, TgUpdate } from "../types";

export async function cmdHealth(env: Env, update: TgUpdate) {
  const chatId = update.message!.chat.id;
  await sendMessage(env, chatId, "ok ✅");
}