// src/commands/id.ts
import { tgSendMessage } from "../utils/telegram";

export async function idCommand(env: any, chatId: number | string, fromId?: number | string) {
  const lines = [
    `<b>Chat ID:</b> <code>${chatId}</code>`,
    fromId ? `<b>User ID:</b> <code>${fromId}</code>` : undefined,
  ].filter(Boolean);
  await tgSendMessage(env, chatId, lines.join("\n"), { parse_mode: "HTML", disable_web_page_preview: true });
}