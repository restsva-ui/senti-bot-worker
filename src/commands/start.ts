// src/commands/start.ts
import type { TgUpdate } from "../types";

export const startCommand = {
  name: "start",
  description: "Початкове повідомлення для користувача",
  async execute(env: { BOT_TOKEN: string; API_BASE_URL?: string }, update: TgUpdate) {
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (!chatId) return;

    const text =
      [
        "👋 Привіт! Я <b>Senti</b> — бот-асистент.",
        "",
        "Корисне:",
        "• <code>/menu</code> — кнопки команд",
        "• <code>/help</code> — довідка",
        "• <code>/wiki</code> — введи запит у відповідь або одразу так: <code>/wiki Київ</code>, <code>/wiki en Albert Einstein</code>",
      ].join("\n");

    await sendMessage(env, chatId, text, { parse_mode: "HTML" });
  },
} as const;

/* -------------------- low-level telegram -------------------- */
async function sendMessage(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }).catch(console.error);
}