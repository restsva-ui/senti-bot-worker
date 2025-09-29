// src/commands/likes.ts
import type { TgUpdate } from "../types";

/** Кнопка з нульовим лічильником */
function likeKeyboard(count: number) {
  return {
    inline_keyboard: [[{ text: `❤️ ${count}`, callback_data: "like" }]],
  };
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

export const likesCommand = {
  name: "likes",
  description: "Показує кнопку ❤️ та рахує натискання",
  async execute(
    env: { BOT_TOKEN: string; API_BASE_URL?: string },
    update: TgUpdate
  ) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text: "Лайкни це повідомлення:",
      reply_markup: likeKeyboard(0),
    });
  },
} as const;

/** Обробка натискання на ❤️ */
export function likesCanHandleCallback(data: string) {
  return data === "like";
}

export async function likesOnCallback(
  env: { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV: any },
  update: TgUpdate
) {
  const cb = update.callback_query!;
  const msg = cb.message;
  const chatId = msg?.chat?.id;
  const msgId = msg?.message_id;
  if (!chatId || !msgId) return;

  const key = `likes:${chatId}:${msgId}`;

  // поточне значення
  const raw = (await env.LIKES_KV.get(key)) ?? "0";
  const current = Number.parseInt(raw) || 0;
  const next = current + 1;

  await env.LIKES_KV.put(key, String(next));

  // оновлюємо підпис кнопки
  await tgCall(env, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: msgId,
    reply_markup: likeKeyboard(next),
  });

  // відповідаємо на callback, щоб прибрати "годинник"
  await tgCall(env, "answerCallbackQuery", {
    callback_query_id: cb.id,
    text: `❤️ ${next}`,
    show_alert: false,
  });
}

/** /stats — зведення по чату */
export const likesStatsCommand = {
  name: "stats",
  description: "Показує суму всіх ❤️ у чаті та кількість повідомлень із лайками",
  async execute(
    env: { BOT_TOKEN: string; API_BASE_URL?: string; LIKES_KV: any },
    update: TgUpdate
  ) {
    const chatId = update.message?.chat?.id;
    if (!chatId) return;

    let total = 0;
    let messagesWithLikes = 0;

    // зчитуємо всі ключі цього чату
    const prefix = `likes:${chatId}:`;
    let cursor: string | undefined = undefined;
    do {
      const page = await env.LIKES_KV.list({ prefix, cursor });
      cursor = page.cursor;
      for (const key of page.keys) {
        const val = await env.LIKES_KV.get(key.name);
        const n = Number.parseInt(val ?? "0") || 0;
        if (n > 0) messagesWithLikes += 1;
        total += n;
      }
    } while (cursor);

    const text = [
      "📊 <b>Статистика лайків</b>",
      `Повідомлень із лайками: <b>${messagesWithLikes}</b>`,
      `Усього ❤️: <b>${total}</b>`,
    ].join("\n");

    await tgCall(env, "sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    });
  },
} as const;