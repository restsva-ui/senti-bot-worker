import { sendMessage } from "../utils/telegram";
import type { Env } from "../index";
import type { TgUpdate } from "../types";

export async function cmdHealth(env: Env, update: TgUpdate) {
  if (!update.message) return;
  await sendMessage(env, update.message.chat.id, "ok ✅");
}

export const healthCommand = {
  name: "health",
  description: "Перевірка стану сервера",
  execute: cmdHealth,
};