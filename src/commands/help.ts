// src/commands/help.ts
import type { TgUpdate } from "../types";
import type { CommandEnv } from "./registry";
import { getCommandsInfo } from "./registry";

export const helpCommand = {
  name: "help",
  description: "Показує список доступних команд",
  async execute(env: CommandEnv, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    const lines = ["📖 <b>Доступні команди</b>"];
    for (const c of getCommandsInfo()) {
      lines.push(`• /${c.name} — ${c.description}`);
    }

    await sendMessage(env, chatId, lines.join("\n"), { parse_mode: "HTML" });
  },
} as const;

async function sendMessage(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("sendMessage error:", res.status, errText);
  }
}