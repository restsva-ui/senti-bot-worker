// src/commands/kvdebug.ts
// Дебаг-команди для KV сховища лайків.

import { sendMessage } from "../telegram/api";

// Оголошуємо KV binding, щоб TypeScript не сварився під час білду.
// У рантаймі цей binding підставляє Cloudflare Workers.
declare const LIKES_KV: any;

// Допоміжне: перевірка наявності binding'у
function hasKv(): boolean {
  return typeof (globalThis as any).LIKES_KV !== "undefined" && LIKES_KV;
}

// Пробуємо розпарсити різні можливі формати значення
function parseLikesValue(raw: string | null): { like: number; dislike: number } {
  if (!raw) return { like: 0, dislike: 0 };
  try {
    const v = JSON.parse(raw);
    // підтримуємо формати:
    // {like: N, dislike: M} або {"like":N,"dislike":M}
    if (
      typeof v === "object" &&
      v !== null &&
      typeof v.like !== "undefined" &&
      typeof v.dislike !== "undefined"
    ) {
      const like = Number(v.like) || 0;
      const dislike = Number(v.dislike) || 0;
      return { like, dislike };
    }
  } catch {}
  // fallback: коли зберігали просто "like" / "dislike" або число
  if (raw === "like") return { like: 1, dislike: 0 };
  if (raw === "dislike") return { like: 0, dislike: 1 };
  const n = Number(raw);
  if (!Number.isNaN(n)) return { like: n, dislike: 0 };
  return { like: 0, dislike: 0 };
}

// /kvtest — показує статус KV, сумарні лічильники та приклади ключів користувачів
export async function cmdKvTest(chatId: number): Promise<void> {
  if (!hasKv()) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  // Збираємо всі ключі голосів
  const allKeys: string[] = [];
  let cursor: string | undefined = undefined;
  do {
    // list може повертати посторінково
    const page = await LIKES_KV.list({ prefix: "likes:", cursor });
    (page.keys as Array<{ name: string }>).forEach((k) => allKeys.push(k.name));
    cursor = page.cursor || undefined;
    if (!page.list_complete && !cursor) break;
  } while (cursor);

  // Підрахунок сумарних like/dislike
  let like = 0;
  let dislike = 0;

  // Щоб не робити сотні get, візьмемо перші до 30 ключів для прикладу,
  // а лічильники спробуємо по можливості теж по цим ключам (цього достатньо для дебаг-команди).
  const sampleKeys = allKeys.slice(0, 10);
  for (const k of allKeys) {
    const v = await LIKES_KV.get(k); // значення може бути JSON/рядок
    const p = parseLikesValue(v);
    like += p.like;
    dislike += p.dislike;
  }

  const userExamples =
    sampleKeys
      .map((k: string) => k.replace(/^likes:/, "")) // лишаємо id
      .filter(Boolean)
      .join(", ") || "—";

  const text =
    `KV статус\n` +
    `LIKES_KV: OK\n\n` +
    `Лічильники\n` +
    `👍 like: ${like}\n` +
    `👎 dislike: ${dislike}\n\n` +
    `Користувачі з голосом (приклади):\n` +
    `${userExamples}`;

  await sendMessage(chatId, text);
}

// /resetlikes — видаляє всі ключі голосів та обнуляє лічильники
export async function cmdResetLikes(chatId: number): Promise<void> {
  if (!hasKv()) {
    await sendMessage(chatId, "❌ KV не прив'язаний");
    return;
  }

  // Зібрати всі ключі з префіксом likes:
  const keys: string[] = [];
  let cursor: string | undefined = undefined;
  do {
    const page = await LIKES_KV.list({ prefix: "likes:", cursor });
    (page.keys as Array<{ name: string }>).forEach((k) => keys.push(k.name));
    cursor = page.cursor || undefined;
    if (!page.list_complete && !cursor) break;
  } while (cursor);

  // Видалити всі знайдені
  let removed = 0;
  for (const k of keys) {
    await LIKES_KV.delete(k);
    removed++;
  }

  await sendMessage(
    chatId,
    `✅ Скинуто лічильники (👍0 | 👎0) та видалено голосів: ${removed}`
  );
}