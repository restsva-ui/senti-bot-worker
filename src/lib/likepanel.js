import { tg } from "../lib/tg.js";

// Ключі KV: likes:<chatId>:up / likes:<chatId>:down
async function getCount(kv, key) {
  if (!kv) return 0;
  const v = await kv.get(key);
  return v ? Number(v) || 0 : 0;
}
async function setCount(kv, key, val) {
  if (!kv) return;
  await kv.put(key, String(val));
}

export async function openLikePanel(env, chatId) {
  const kv = env.STATE;
  const upKey = `likes:${chatId}:up`;
  const downKey = `likes:${chatId}:down`;
  const [up, down] = await Promise.all([getCount(kv, upKey), getCount(kv, downKey)]);

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: `Оцінки: 👍 ${up}  |  👎 ${down}`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "👍", callback_data: "like:up" },
          { text: "👎", callback_data: "like:down" }
        ],
      ],
    },
  });
}

export async function handleLikeCallback(env, update) {
  const data = update.callback_query?.data;
  const chatId = update.callback_query?.message?.chat?.id;
  const messageId = update.callback_query?.message?.message_id;
  if (!data || !chatId) return;

  // відкриття панелі
  if (data === "like:panel") {
    return openLikePanel(env, chatId);
  }

  // натискання 👍/👎
  if (data === "like:up" || data === "like:down") {
    const kv = env.STATE;
    const upKey = `likes:${chatId}:up`;
    const downKey = `likes:${chatId}:down`;
    const isUp = data.endsWith("up");

    const curUp = await getCount(kv, upKey);
    const curDown = await getCount(kv, downKey);
    const newUp = isUp ? curUp + 1 : curUp;
    const newDown = isUp ? curDown : curDown + 1;

    await Promise.all([
      setCount(kv, upKey, newUp),
      setCount(kv, downKey, newDown),
      tg(env, "answerCallbackQuery", {
        callback_query_id: update.callback_query.id,
        text: isUp ? "Дякую за 👍" : "Дякую за 👎",
        show_alert: false
      }),
      // Оновлюємо текст та клавіатуру в тому ж повідомленні
      tg(env, "editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: `Оцінки: 👍 ${newUp}  |  👎 ${newDown}`,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "👍", callback_data: "like:up" },
              { text: "👎", callback_data: "like:down" }
            ],
          ],
        },
      }),
    ]);
  }
}