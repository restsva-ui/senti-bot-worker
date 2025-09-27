// src/commands/likepanel.ts
// Показує панель лайків. Без доступу до KV, щоб не ламати існуючу логіку.
// Лічильники показуємо як 0/0 — актуальні значення все одно відображає /kvtest.
// Callback data узгоджена з роутером: "like" та "dislike".

import { sendMessage } from "../telegram/api";

export async function cmdLikePanel(chatId: number): Promise<void> {
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "👍", callback_data: "like" },
        { text: "👎", callback_data: "dislike" },
      ],
    ],
  };

  await sendMessage(chatId, "Оцінки: 👍 0 | 👎 0", reply_markup);
}