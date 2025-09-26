// src/commands/kvdebug.ts
import { getEnv } from "../config";
import { sendMessage } from "../telegram/api";

export async function cmdKvList(chatId: number) {
  const env = getEnv();
  if (!env.KV) return sendMessage(chatId, "❌ KV не прив'язаний");
  const list = await env.KV.list({ limit: 20 });
  const text = list.keys.length
    ? "🔑 Ключі:\n" + list.keys.map(k => `• ${k.name}`).join("\n")
    : "📭 KV порожній";
  return sendMessage(chatId, text);
}

export async function cmdKvGet(chatId: number, key: string) {
  const env = getEnv();
  if (!env.KV) return sendMessage(chatId, "❌ KV не прив'язаний");
  const v = await env.KV.get(key);
  return sendMessage(chatId, v ? `📦 ${key} = ${v}` : `❓ Ключ "${key}" не знайдено`);
}