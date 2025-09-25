import { tg } from "../lib/tg.js";

export async function showStats(env, chatId) {
  const kv = env.STATE;
  if (!kv) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "ℹ️ KV (STATE) не підключено — статистика недоступна.",
    });
    return;
  }
  const [up, down] = await Promise.all([
    kv.get(`likes:${chatId}:up`),
    kv.get(`likes:${chatId}:down`),
  ]);
  const upN = up ? Number(up) || 0 : 0;
  const downN = down ? Number(down) || 0 : 0;

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: `📊 Статистика для чату ${chatId}:\n• 👍 ${upN}\n• 👎 ${downN}`,
  });
}