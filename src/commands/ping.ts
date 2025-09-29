// src/commands/ping.ts
import type { TgUpdate } from "../types";
import type { Command } from "./types";

async function tgCall(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  method: string,
  payload: Record<string, unknown>
) {
  const api = env.API_BASE_URL || "https://api.telegram.org";
  const res = await fetch(`${api}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({}));
}

export const pingCommand: Command = {
  name: "ping",
  description: "Перевірка зв’язку",
  async execute(env, update) {
    const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
    if (!chatId) return;
    await tgCall(env as any, "sendMessage", {
      chat_id: chatId,
      text: "pong ✅",
    });
  },
};