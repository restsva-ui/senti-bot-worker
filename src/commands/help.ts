// src/commands/help.ts
import type { TgUpdate } from "../types";
import { getCommandsInfo } from "./registry";

type EnvBase = { BOT_TOKEN: string; API_BASE_URL?: string };

export const helpCommand = {
  name: "help",
  description: "Показує довідку по доступних командах",
  async execute(env: EnvBase, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    const cmds = getCommandsInfo();
    const lines = [
      "ℹ️ <b>Довідка по командам</b>",
      "",
      ...cmds.map(
        (c) => `• <code>/${c.name}</code> — ${escapeHtml(c.description || "")}`
      ),
      "",
      "Підказка: натисни <code>/wiki</code> — і просто введи запит у відповідь.",
    ];

    await sendMessage(env, chatId, lines.join("\n"), { parse_mode: "HTML" });
  },
} as const;

/* --------------- low-level telegram --------------- */
async function sendMessage(
  env: EnvBase,
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

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}