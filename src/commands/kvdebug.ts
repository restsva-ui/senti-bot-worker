// src/commands/kvdebug.ts
import { getEnv } from "../config";
import { sendMessage } from "../telegram/api";

export async function cmdKvList(chatId: number) {
  const env = getEnv();
  if (!env.kv) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }
  await sendMessage(chatId, "✅ KV OK");
}