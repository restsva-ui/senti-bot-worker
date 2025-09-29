// src/commands/start.ts
import type { TgUpdate } from "../types";

type EnvBase = { BOT_TOKEN: string; API_BASE_URL?: string };

export const startCommand = {
  name: "start",
  description: "Початкове повідомлення для користувача",
  async execute(env: EnvBase, update: TgUpdate) {
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (!chatId) return;

    const text = [
      "👋 Привіт! Я <b>Senti</b> — бот-асистент.",
      "",
      "Основні команди:",
      "• /ping — перевірка звʼязку",
      "• /menu — кнопки з командами",
      "• /likes — показати ❤️ під повідомленням",
      "• /stats — статистика лайків",
      "• /wiki — натисни й просто введи запит у відповідь",
      "",
      "Довідка: /help",
    ].join("\n");

    await sendMessage(env, chatId, text, { parse_mode: "HTML" });
  },
} as const;

/* -------------------- low-level telegram -------------------- */
async function sendMessage(
  env: EnvBase,
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("sendMessage error:", res.status, errText);
  }
}