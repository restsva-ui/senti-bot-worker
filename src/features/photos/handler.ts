import { Env } from "../../index";
import { tgSendMessage } from "../../utils/telegram";

export async function handlePhoto(update: any, env: Env, chatId: number) {
  try {
    const photos = update?.message?.photo;
    if (!photos || photos.length === 0) return;

    // найбільше фото (краща якість)
    const largest = photos[photos.length - 1];
    const fileId = largest.file_id;

    // збережемо fileId у KV
    if (env.SENTI_CACHE) {
      await env.SENTI_CACHE.put(`lastPhoto:${chatId}`, fileId, { expirationTtl: 600 });
    }

    await tgSendMessage(env, chatId, "📸 Фото отримано! Тепер напиши, що з ним зробити.");
  } catch (err: any) {
    await tgSendMessage(env, chatId, `⚠️ Помилка обробки фото: ${err.message || String(err)}`);
  }
}