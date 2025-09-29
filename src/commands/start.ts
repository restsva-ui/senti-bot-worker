// src/commands/start.ts
import type { TgUpdate } from "../types";

type Env = { BOT_TOKEN: string; API_BASE_URL?: string };

async function tgCall(
  env: Env,
  method: string,
  payload: Record<string, unknown>
) {
  const api = env.API_BASE_URL || "https://api.telegram.org";
  const res = await fetch(`${api}/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("tgCall error", method, res.status, t);
  }
  return res.json().catch(() => ({}));
}

/**
 * /start — вітання + ФІКСУЄ нативне меню Telegram (only: /help, /wiki)
 * Меню з’являється у полі «Меню» в клієнті Telegram.
 */
export const startCommand = {
  name: "start",
  description: "Запуск і вітання",
  async execute(env: Env, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    // 1) Звужуємо список видимих команд у Telegram-меню
    // тільки /help та /wiki (локальне описання українською й англійською)
    const commands = [
      { command: "help", description: "Довідка" },
      { command: "wiki", description: "Коротка довідка з Вікіпедії" },
    ];

    // Глобально (усі мови)
    await tgCall(env, "setMyCommands", { commands });

    // Опційно — окремо для англійської мови
    await tgCall(env, "setMyCommands", {
      commands: [
        { command: "help", description: "Show help" },
        { command: "wiki", description: "Wikipedia quick lookup" },
      ],
      language_code: "en",
    });

    // 2) Привітання
    const text = [
      "👋 Привіт! Я <b>Senti</b> — бот-асистент.",
      "",
      "Корисне:",
      "• <code>/menu</code> — кнопки команд",
      "• <code>/help</code> — довідка",
      "• <code>/wiki</code> — введи запит у відповідь або одразу так: <code>/wiki Київ</code>, <code>/wiki en Albert Einstein</code>",
      "• <code>/ping</code> — перевірка зв’язку",
    ].join("\n");

    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  },
} as const;