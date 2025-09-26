// src/commands/kvdebug.ts

import { getEnv } from "../config";
import { sendMessage } from "../telegram/api";

const COUNTS_KEY = "likes:counts";
const USER_PREFIX = "likes:user:";

type Counts = { like: number; dislike: number };

// Допоміжне: безпечно прочитати лічильники
async function readCounts(kv: KVNamespace): Promise<Counts> {
  try {
    const raw = await kv.get(COUNTS_KEY);
    if (!raw) return { like: 0, dislike: 0 };
    const j = JSON.parse(raw) as Partial<Counts>;
    return {
      like: Number(j.like ?? 0),
      dislike: Number(j.dislike ?? 0),
    };
  } catch {
    return { like: 0, dislike: 0 };
  }
}

// Допоміжне: записати лічильники
async function writeCounts(kv: KVNamespace, c: Counts) {
  await kv.put(COUNTS_KEY, JSON.stringify(c));
}

/**
 * /kvtest — показує статус прив’язки LIKES_KV, поточні лічильники
 * та приклади ключів користувачів, що голосували
 */
export async function cmdKvTest(chatId: number) {
  const env = getEnv();

  if (!env.LIKES_KV) {
    await sendMessage(chatId, "❌ KV не прив'язаний (LIKES_KV)");
    return;
  }

  const kv = env.LIKES_KV;
  const counts = await readCounts(kv);

  // Зберемо кілька прикладів ключів користувачів
  const examples: string[] = [];
  let cursor: string | undefined = undefined;
  do {
    const page = await kv.list({ prefix: USER_PREFIX, cursor });
    for (const k of page.keys) {
      if (examples.length < 3) examples.push(k.name);
    }
    cursor = page.list_complete ? undefined : page.cursor;
    // досить однієї-двох сторінок для прев’ю
  } while (cursor && examples.length < 3);

  const votersInfo =
    examples.length === 0
      ? "нема прикладів"
      : examples.map((k) => k.replace(USER_PREFIX, "")).join(", ");

  const text =
    `KV статус\n` +
    `LIKES_KV: OK\n\n` +
    `Лічильники\n` +
    `👍 like: ${counts.like}\n` +
    `👎 dislike: ${counts.dislike}\n\n` +
    `Користувачі з голосом (приклади): ${votersInfo}`;

  await sendMessage(chatId, text);
}

/**
 * /resetlikes — скидає лічильники та всі індивідуальні голоси
 * (видаляє ключі з префіксом likes:user:)
 */
export async function cmdResetLikes(chatId: number) {
  const env = getEnv();

  if (!env.LIKES_KV) {
    await sendMessage(chatId, "❌ KV не прив'язаний (LIKES_KV)");
    return;
  }

  const kv = env.LIKES_KV;

  // 1) Скинути загальні лічильники
  await writeCounts(kv, { like: 0, dislike: 0 });

  // 2) Видалити усі голоси користувачів (пагінація)
  let deleted = 0;
  let cursor: string | undefined = undefined;
  do {
    const page = await kv.list({ prefix: USER_PREFIX, cursor });
    for (const k of page.keys) {
      await kv.delete(k.name);
      deleted++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  await sendMessage(
    chatId,
    `✅ Скинуто лічильники (👍0 | 👎0) та видалено голосів: ${deleted}`
  );
}