import { getEnv } from "../config";
import { sendMessage } from "../telegram/api";

export async function handleKVList(chatId: number) {
  const env = getEnv();
  if (!env?.KV) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  const list = await env.KV.list({ limit: 10 });
  if (!list.keys.length) {
    await sendMessage(chatId, "📭 KV порожній.");
    return;
  }

  const keys = list.keys.map(k => `• ${k.name}`).join("\n");
  await sendMessage(chatId, `🔑 Ключі KV:\n${keys}`);
}

export async function handleKVGet(chatId: number, key: string) {
  const env = getEnv();
  if (!env?.KV) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  const value = await env.KV.get(key);
  if (!value) {
    await sendMessage(chatId, `❓ Ключ "${key}" не знайдено`);
    return;
  }

  await sendMessage(chatId, `📦 KV[${key}] = ${value}`);
}