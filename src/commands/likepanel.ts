// src/commands/likepanel.ts
import { answerCallbackQuery, editMessageText, sendMessage } from "../telegram/api";
import { getEnv } from "../config"; // якщо є KV для лічильників

// Спрощена реалізація: якщо є KV (env.STATE), рахуємо; якщо ні — просто показуємо кнопки
async function readKV(key: string): Promise<number> {
  const kv = getEnv().STATE;
  if (!kv) return 0;
  const v = await kv.get(key);
  return v ? Number(v) || 0 : 0;
}
async function writeKV(key: string, val: number) {
  const kv = getEnv().STATE;
  if (!kv) return;
  await kv.put(key, String(val));
}

export async function likepanel(chatId: number | string) {
  const upKey = `likes:${chatId}:up`;
  const downKey = `likes:${chatId}:down`;
  const [up, down] = await Promise.all([readKV(upKey), readKV(downKey)]);

  await sendMessage(chatId, `Оцінки: 👍 ${up}  |  👎 ${down}`, {
    reply_markup: {
      inline_keyboard: [[{ text: "👍", callback_data: "like:up" }, { text: "👎", callback_data: "like:down" }]],
    },
  });
}

// Хендлер для callback'ів лайків
export async function handleLikeCallback(update: any) {
  const data: string | undefined = update?.callback_query?.data;
  const cqId: string | undefined = update?.callback_query?.id;
  const chatId: number | string | undefined = update?.callback_query?.message?.chat?.id;
  const messageId: number | undefined = update?.callback_query?.message?.message_id;
  if (!data || !chatId) return false;

  if (data === "cb_likepanel" || data === "like:panel") {
    await likepanel(chatId);
    if (cqId) await answerCallbackQuery(cqId);
    return true;
  }

  if (data === "like:up" || data === "like:down") {
    const isUp = data.endsWith("up");
    const upKey = `likes:${chatId}:up`;
    const downKey = `likes:${chatId}:down`;
    const curUp = await readKV(upKey);
    const curDown = await readKV(downKey);
    const newUp = isUp ? curUp + 1 : curUp;
    const newDown = isUp ? curDown : curDown + 1;
    await Promise.all([writeKV(upKey, newUp), writeKV(downKey, newDown)]);
    if (cqId) await answerCallbackQuery(cqId, { text: isUp ? "Дякую за 👍" : "Дякую за 👎" });
    if (messageId) {
      await editMessageText(chatId, messageId, `Оцінки: 👍 ${newUp}  |  👎 ${newDown}`, {
        reply_markup: {
          inline_keyboard: [[{ text: "👍", callback_data: "like:up" }, { text: "👎", callback_data: "like:down" }]],
        },
      });
    }
    return true;
  }

  return false;
}