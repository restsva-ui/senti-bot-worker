import { sendMessage } from "../utils/telegram";
import type { Env } from "../index";
import type { TgUpdate } from "../types";

export async function cmdPing(env: Env, update: TgUpdate) {
  if (!update.message) return;
  await sendMessage(env, update.message.chat.id, "pong ✅");
}

export const pingCommand = {
  name: "ping",
  description: "Перевірка звʼязку (pong)",
  execute: cmdPing,
};