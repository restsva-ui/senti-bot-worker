// src/commands/menu.ts
import type { TgUpdate } from "../types";

const CB_PREFIX = "menu:";
const CB_PING = `${CB_PREFIX}ping`;
const CB_HELP = `${CB_PREFIX}help`;

export const menuCommand = {
  name: "menu",
  description: "Показує меню з кнопками (inline keyboard)",
  async execute(env: { BOT_TOKEN: string; API_BASE_URL?: string }, update: TgUpdate) {
    const msg = update.message;
    const chatId = msg?.chat?.id;
    if (!chatId) return;

    const keyboard = {
      inline_keyboard: [
        [
          { text: "Пінг ✅", callback_data: CB_PING },
          { text: "Допомога ℹ️", callback_data: CB_HELP },
        ],
      ],
    };

    await sendMessage(env, chatId, "Меню:", {
      reply_markup: keyboard,
    });
  },
} as const;

/** Чи може цей модуль обробити callback data */
export function menuCanHandleCallback(data: string | undefined): boolean {
  return typeof data === "string" && data.startsWith(CB_PREFIX);
}

/** Обробка callback_query від кнопок меню */
export async function menuOnCallback(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  update: TgUpdate
): Promise<void> {
  const cq: any = (update as any).callback_query;
  const data: string | undefined = cq?.data;
  const chatId: number | undefined = cq?.message?.chat?.id;
  const cqId: string | undefined = cq?.id;

  if (!data || !chatId || !cqId) return;

  if (data === CB_PING) {
    await answerCallbackQuery(env, cqId, "pong ✅");
    await sendMessage(env, chatId, "pong ✅");
    return;
  }

  if (data === CB_HELP) {
    await answerCallbackQuery(env, cqId); // без повідомлення
    await sendMessage(
      env,
      chatId,
      [
        "Доступні команди:",
        "• /ping — перевірка зв'язку",
        "• /echo <текст> — повторить ваш текст",
        "• /menu — показати кнопки",
      ].join("\n")
    );
    return;
  }

  // Невідомий кейс — просто тихо відповідаємо на callback
  await answerCallbackQuery(env, cqId);
}

/* ===================== низькорівневі виклики Telegram API ===================== */

async function sendMessage(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  chatId: number,
  text: string,
  extra?: Record<string, unknown>
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text, ...extra });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("sendMessage error:", res.status, errText);
  }
}

async function answerCallbackQuery(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  callbackQueryId: string,
  text?: string
) {
  const apiBase = env.API_BASE_URL || "https://api.telegram.org";
  const url = `${apiBase}/bot${env.BOT_TOKEN}/answerCallbackQuery`;
  const body = JSON.stringify(
    text ? { callback_query_id: callbackQueryId, text } : { callback_query_id: callbackQueryId }
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("answerCallbackQuery error:", res.status, errText);
  }
}