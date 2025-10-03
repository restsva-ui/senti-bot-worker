// src/features/photos/handler.ts
import { tgSendMessage, getFile } from "../../utils/telegram";

export async function handlePhoto(update: any, env: any, chatId: number) {
  const photos = update.message.photo;
  if (!photos?.length) return;

  const biggest = photos[photos.length - 1];
  const fileId = biggest.file_id;

  // зберігаємо file_id у KV
  if (env.SENTI_CACHE) {
    await env.SENTI_CACHE.put(`lastPhoto:${chatId}`, fileId, { expirationTtl: 600 });
  }

  await tgSendMessage(env, chatId, "Фото збережено ✅ Тепер напиши, що з ним зробити.");
}