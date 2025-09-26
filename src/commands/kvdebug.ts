import { sendMessage } from "../telegram/api";
import { KV } from "../config";

export async function handleKVGet(chatId: number, key: string) {
  try {
    const value = await KV.get(key);
    await sendMessage(chatId, value ? `🔑 KV[${key}] = ${value}` : `❌ KV[${key}] не знайдено`);
  } catch (err) {
    await sendMessage(chatId, `⚠️ Помилка KV.get(${key}): ${err}`);
  }
}

export async function handleKVList(chatId: number) {
  try {
    const list = await KV.list({ limit: 10 });
    if (list.keys.length === 0) {
      await sendMessage(chatId, "📭 KV порожній");
    } else {
      const keys = list.keys.map(k => `• ${k.name}`).join("\n");
      await sendMessage(chatId, `📂 KV keys:\n${keys}`);
    }
  } catch (err) {
    await sendMessage(chatId, `⚠️ Помилка KV.list(): ${err}`);
  }
}