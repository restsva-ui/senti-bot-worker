import { sendMessage } from "../utils/telegram";
import type { Env } from "../index";
import type { TgUpdate } from "../types";

export async function cmdStart(env: Env, update: TgUpdate) {
  if (!update.message) return;
  const chatId = update.message.chat.id;
  await sendMessage(
    env,
    chatId,
    "✅ Senti онлайн\nНадішли /ping щоб перевірити відповідь."
  );
}

export const startCommand = {
  name: "start",
  description: "Запуск і вітання",
  execute: cmdStart,
};