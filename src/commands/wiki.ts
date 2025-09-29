// src/commands/wiki.ts
import type { TgUpdate } from "../types";

export const wikiCommand = {
  name: "wiki",
  description: "Пошук стислої довідки у Вікіпедії (MVP)",
  async execute(env: { BOT_TOKEN: string; API_BASE_URL?: string }, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text ?? "";
    if (!chatId) return;

    const q = (text.replace(/^\/wiki(?:@\w+)?/i, "").trim()) || "Київ";
    const reply = `Поки що демо: пошук «${q}». (реалізацію додамо окремим кроком)`;
    await sendMessage(env, chatId, reply);
  },
} as const;

async function sendMessage(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  chatId: number,
  text: string
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text });

  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("sendMessage error:", res.status, errText);
  }
}