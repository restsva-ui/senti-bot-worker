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
  // не валимо воркер, просто логнемо
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("tgCall error", method, res.status, t);
  }
  return res.json().catch(() => ({}));
}

export const startCommand = {
  name: "start",
  description: "Початкове повідомлення для користувача",
  async execute(env: Env, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

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
    });
  },
} as const;