// src/commands/kvdebug.ts
// Усі службові команди з KV: /kvtest, /resetlikes, /stats, /export

import { getEnv, type Env } from "../config";
import { sendMessage } from "../telegram/api";

type Counts = { like: number; dislike: number };

const COUNTS_KEY = "likes:counts";
const USER_PREFIX = "likes:user:";

async function readCounts(kv: KVNamespace): Promise<Counts> {
  try {
    const raw = await kv.get(COUNTS_KEY);
    if (!raw) return { like: 0, dislike: 0 };
    const parsed = JSON.parse(raw) as Partial<Counts>;
    return {
      like: Number(parsed.like ?? 0),
      dislike: Number(parsed.dislike ?? 0),
    };
  } catch {
    return { like: 0, dislike: 0 };
  }
}

export async function cmdKvList(chatId: number) {
  const env = getEnv();
  const kv = env.KV;
  if (!kv) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  const counts = await readCounts(kv);
  const users = await kv.list({ prefix: USER_PREFIX });

  const examples =
    users.keys
      .slice(0, 5)
      .map((k) => k.name.replace(USER_PREFIX, "likes:user:"))
      .join("\n") || "—";

  const text =
    `KV статус\nLIKES_KV: OK\n\n` +
    `Лічильники\n👍 like: ${counts.like}\n👎 dislike: ${counts.dislike}\n\n` +
    `Користувачі з голосом (приклади):\n${examples}`;

  await sendMessage(chatId, text);
}

export async function cmdResetLikes(chatId: number) {
  const env = getEnv();
  const kv = env.KV;
  if (!kv) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  // видалити підсумки
  await kv.delete(COUNTS_KEY);

  // видалити голоси користувачів
  const users = await kv.list({ prefix: USER_PREFIX });
  let deleted = 0;
  for (const k of users.keys) {
    await kv.delete(k.name);
    deleted++;
  }

  await sendMessage(
    chatId,
    `✅ Скинуто лічильники (👍0 | 👎0) та видалено голосів: ${deleted}`
  );
}

// ===== Нові команди: /stats і /export (лише OWNER) =====

/** Коротка статистика */
export async function cmdStats(chatId: number) {
  const env = getEnv();
  const kv = env.KV;
  if (!kv) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  const counts = await readCounts(kv);
  const users = await kv.list({ prefix: USER_PREFIX });
  const voters = users.keys.length;

  const text =
    "📊 Статистика лайків\n" +
    `Усього користувачів з голосом: ${voters}\n` +
    `👍: ${counts.like} | 👎: ${counts.dislike}\n` +
    (voters > 0
      ? `Приклади ключів:\n` +
        users.keys
          .slice(0, 5)
          .map((k) => k.name.replace(USER_PREFIX, "likes:user:"))
          .join("\n")
      : "");

  await sendMessage(chatId, text || "Поки що даних немає.");
}

/** Експорт у компактний JSON (з підрізанням, якщо дуже великий) */
export async function cmdExport(chatId: number) {
  const env = getEnv();
  const kv = env.KV;
  if (!kv) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  const counts = await readCounts(kv);
  const users = await kv.list({ prefix: USER_PREFIX });

  // Зберемо простий список користувачів і їхній голос
  const voters: Record<string, "like" | "dislike"> = {};
  for (const k of users.keys) {
    const userId = k.name.replace(USER_PREFIX, "");
    const v = await kv.get(k.name);
    if (v === "like" || v === "dislike") voters[userId] = v;
  }

  const payload = {
    counts,
    voters_total: Object.keys(voters).length,
    voters, // може бути великим
  };

  let json = JSON.stringify(payload);
  // Telegram обмежує ~4096 символів у повідомленні — залишимо запас
  const LIMIT = 3800;
  if (json.length > LIMIT) {
    // якщо забагато — відріжемо деталі, але залишимо підсумки
    json = JSON.stringify({
      counts,
      voters_total: Object.keys(voters).length,
      note:
        "payload скорочено для повідомлення (надто великий). Для повного дампу доведеться надсилати файлом.",
    });
  }

  await sendMessage(chatId, "📤 Експорт JSON:\n<pre>" + json + "</pre>", {
    parse_mode: "HTML",
  });
}