import type { TgUpdate } from "../types";

const MENU_CB_WIKI = "menu:wiki";
const MENU_CB_HELP = "menu:help";

export function menuCanHandleCallback(data: string) {
  return data === MENU_CB_WIKI || data === MENU_CB_HELP;
}

async function tgCall(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
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

export const menuCommand = {
  name: "menu",
  description: "Показати меню",
  async execute(env: { BOT_TOKEN: string; API_BASE_URL?: string }, update: TgUpdate) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "Меню:",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔎 Wiki", callback_data: MENU_CB_WIKI }],
          [{ text: "❓ Help", callback_data: MENU_CB_HELP }],
        ],
      },
    });
  },
} as const;

export async function menuOnCallback(
  env: { BOT_TOKEN: string; API_BASE_URL?: string },
  update: TgUpdate
) {
  const cb = update.callback_query!;
  const chatId = cb.message?.chat?.id;
  if (!chatId) return;

  if (cb.data === MENU_CB_HELP) {
    const msg = [
      "Доступні команди:",
      "• /wiki <запит> — пошук у вікі. Без аргументів — відкриє запит.",
      "• /menu — показати меню кнопок",
      "• /likes — повідомлення з ❤️",
      "• /stats — статистика лайків",
    ].join("\n");
    await tgCall(env, "answerCallbackQuery", { callback_query_id: cb.id });
    await tgCall(env, "sendMessage", { chat_id: chatId, text: msg });
    return;
  }

  if (cb.data === MENU_CB_WIKI) {
    await tgCall(env, "answerCallbackQuery", { callback_query_id: cb.id });
    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "✍️ Напишіть ваш запит для Wiki повідомленням-відповіддю на це.",
      reply_markup: { force_reply: true, selective: true },
    });
  }
}