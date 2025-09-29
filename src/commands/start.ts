import type { Command } from "./types";

export const startCommand: Command = {
  name: "start",
  description: "Почати роботу з ботом",
  async execute(env, update) {
    const chatId = update.message?.chat.id;
    if (!chatId) return;
    await fetch(`${env.API_BASE_URL}/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "👋 Вітаю! Це Senti Bot. Використай /help щоб побачити всі команди.",
      }),
    });
  },
};