import { tgSendMessage } from "../../utils/telegram";

type EnvAll = { SENTI_CACHE?: KVNamespace };

export async function handlePhoto(update: any, env: EnvAll, chatId: number) {
  const photos = update?.message?.photo as { file_id: string }[] | undefined;
  const best = photos?.[photos.length - 1];
  if (!best?.file_id) return;

  const ts = Date.now();
  const ttl = 600; // 10 хвилин з запасом

  // ✅ Уніфікований ключ + metadata.ts
  await env.SENTI_CACHE?.put(
    `photo:last:${chatId}`,
    best.file_id,
    { expirationTtl: ttl, metadata: { ts } } as any
  );

  // 🔁 Сумісність зі старими ключами (без metadata — не критично)
  await env.SENTI_CACHE?.put(`lastPhoto:${chatId}`, best.file_id, { expirationTtl: ttl });
  await env.SENTI_CACHE?.put(`last_photo:${chatId}`, best.file_id, { expirationTtl: ttl });
  await env.SENTI_CACHE?.put(`photos:last:${chatId}`, best.file_id, { expirationTtl: ttl });
  await env.SENTI_CACHE?.put(`tg:lastPhoto:${chatId}`, best.file_id, { expirationTtl: ttl });

  await tgSendMessage(
    env as any,
    chatId,
    "Фото отримав ✅ Тепер надішли коротку підказку текстом — що саме проаналізувати?"
  );
}