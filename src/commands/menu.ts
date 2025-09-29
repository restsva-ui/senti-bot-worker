// src/commands/menu.ts
import type { TgUpdate } from "../types";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string };

export const menuCommand = {
  name: "menu",
  description: "Показує спрощене меню з кнопками (Help, Wiki)",
  async execute(env: Env, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    await sendMessage(env, chatId, "🗂️ Меню:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "ℹ️ Help", callback_data: "menu:help" },
            { text: "📚 Wiki", callback_data: "menu:wiki" },
          ],
        ],
      },
    });
  },
} as const;

// Чи можемо обробити callback від меню
export function menuCanHandleCallback(data: string) {
  return data?.startsWith("menu:");
}

// Обробка callback’ів
export async function menuOnCallback(env: Env, update: TgUpdate) {
  const cb = update.callback_query;
  if (!cb?.data) return;
  const chatId = cb.message?.chat?.id;
  if (!chatId) return;

  const action = cb.data.slice("menu:".length);

  if (action === "help") {
    const text =
      "ℹ️ Довідка по командам\n\n" +
      "• /start — Початкове повідомлення\n" +
      "• /ping — Перевірка звʼязку\n" +
      "• /health — Статус OK\n" +
      "• /menu — Спрощене меню (Help, Wiki)\n" +
      "• /echo — Повторює текст\n" +
      "• /likes — Показує кнопку ❤️ та рахує натискання\n" +
      "• /stats — Показує суму всіх ❤️ у чаті та кількість повідомлень із лайками\n" +
      "• /wiki — Довідка з Вікі: /wiki <lang?> <запит> (uk/ru/en/de/fr)";
    await editMessage(env, chatId, cb.message!.message_id, text, {});
    return;
  }

  if (action === "wiki") {
    await editMessage(env, chatId, cb.message!.message_id,
      "🔎 Введіть запит для /wiki:", {});
    return;
  }
}

/* -------------------- low-level telegram -------------------- */
async function sendMessage(
  env: Env,
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
  }).catch(() => {});
}

async function editMessage(
  env: Env,
  chatId: number,
  messageId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/editMessageText`;
  const body = JSON.stringify({
    chat_id: chatId,
    message_id: messageId,
    text,
    ...extra,
  });

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }).catch(() => {});
}