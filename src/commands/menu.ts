// src/commands/menu.ts
import type { TgUpdate } from "../types";

export const menuCommand = {
  name: "menu",
  description: "Показує меню з кнопками команд",
  async execute(env: { BOT_TOKEN: string; API_BASE_URL?: string }, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "🏓 Ping",  callback_data: "cmd_ping"  },
          { text: "📊 Stats", callback_data: "cmd_stats" },
        ],
        [
          { text: "❤️ Likes", callback_data: "cmd_likes" },
          { text: "📖 Wiki",  callback_data: "cmd_wiki"  },
        ],
        [
          { text: "🆘 Help",  callback_data: "cmd_help"  },
        ],
      ],
    };

    await sendMessage(env, chatId, "📋 Меню:", { reply_markup: keyboard });
  },
} as const;

/* -------------------- Callback router -------------------- */
export function menuCanHandleCallback(data: string | undefined): boolean {
  return !!data && data.startsWith("cmd_");
}

export async function menuOnCallback(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  update: TgUpdate
) {
  const cq: any = (update as any).callback_query;
  const data: string | undefined = cq?.data;
  const chatId = cq?.message?.chat?.id;
  const cqId = cq?.id;
  if (!data || !chatId || !cqId) return;

  switch (data) {
    case "cmd_ping":  await sendText(env, chatId, "/ping");  break;
    case "cmd_stats": await sendText(env, chatId, "/stats"); break;
    case "cmd_likes": await sendText(env, chatId, "/likes"); break;
    case "cmd_help":  await sendText(env, chatId, "/help");  break;
    case "cmd_wiki":
      // Просимо ввести запит для /wiki (ForceReply)
      await sendMessage(env, chatId, "🔎 Введіть запит для /wiki:", {
        reply_markup: {
          force_reply: true,
          input_field_placeholder:
            "Напр.: Київ • en Albert Einstein • de Berlin • fr Paris",
        },
      });
      break;
  }

  await answerCallbackQuery(env, cqId);
}

/* -------------------- Low-level Telegram -------------------- */
async function sendMessage(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
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

async function sendText(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  chatId: number,
  text: string
) {
  return sendMessage(env, chatId, text);
}

async function answerCallbackQuery(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  callbackQueryId: string
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/answerCallbackQuery`;
  const body = JSON.stringify({ callback_query_id: callbackQueryId });

  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }).catch(console.error);
}