// src/commands/kvdebug.ts
import { getEnv } from "../config";
import { sendMessage } from "../telegram/api";

/** /kvtest — діагностика KV */
export async function cmdKvTest(chatId: number) {
  const env = getEnv();

  if (!env.KV) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  // статус
  let status = "LIKES_KV: OK";
  try {
    await env.KV.put("test_key", "hello from kv");
  } catch {
    status = "LIKES_KV: ❌";
  }

  // лічильники
  let like = 0, dislike = 0;
  try {
    const raw = await env.KV.get("likes:counts");
    if (raw) {
      const parsed = JSON.parse(raw) as { like?: number; dislike?: number };
      like = Number(parsed.like ?? 0);
      dislike = Number(parsed.dislike ?? 0);
    }
  } catch {}

  // скільки ключів користувачів
  let usersExample = "—";
  let totalUserKeys = 0;
  try {
    const list = await env.KV.list({ prefix: "likes:user:" });
    totalUserKeys = list.keys.length;
    if (list.keys[0]) usersExample = list.keys[0].name;
  } catch {}

  const text =
    `KV статус\n` +
    `${status}\n\n` +
    `Лічильники\n` +
    `👍 like: ${like}\n` +
    `👎 dislike: ${dislike}\n\n` +
    `Користувачі з голосом\n` +
    `всього ключів: ${totalUserKeys}\n` +
    `приклади:\n` +
    `${usersExample}`;

  await sendMessage(chatId, text);
}

/** /resetlikes — скинути сумарні лічильники (тільки OWNER) */
export async function cmdResetLikes(chatId: number) {
  const env = getEnv();
  const isOwner = String(chatId) === String(env.OWNER_ID);

  if (!isOwner) {
    await sendMessage(chatId, "⛔ Лише власник може виконати цю команду.");
    return;
  }
  if (!env.KV) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  // Скидаємо лише агрегований лічильник, юзерські голоси не чіпаємо
  await env.KV.delete("likes:counts");
  await sendMessage(chatId, "🔄 Лічильники скинуто: 👍 0 | 👎 0");
}