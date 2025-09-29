// src/commands/help.ts
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

export const helpCommand = {
  name: "help",
  description: "Показує довідку по доступних командах",
  async execute(env: Env, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    const text = [
      "ℹ️ <b>Довідка по командам</b>",
      "",
      "• <code>/start</code> — початкове повідомлення",
      "• <code>/ping</code> — перевірка зв’язку (pong)",
      "• <code>/health</code> — повертає статус OK",
      "• <code>/help</code> — показує цю довідку",
      "• <code>/wiki</code> — пошук стислої довідки у Вікіпедії",
      "",
      "Порада: надішли <code>/wiki</code> і впиши запит у відповідь, або одразу так:",
      "<code>/wiki Київ</code>, <code>/wiki en Albert Einstein</code>.",
    ].join("\n");

    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  },
} as const;