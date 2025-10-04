import { tgSendMessage } from "../../utils/telegram";

type EnvAll = {
  SENTI_CACHE?: KVNamespace;
};

export async function handlePhoto(update: any, env: EnvAll, chatId: number) {
  const photos = update?.message?.photo as { file_id: string }[] | undefined;
  const best = photos?.[photos.length - 1];
  if (!best?.file_id) return;
  // зберігаємо під двома ключами для сумісності зі старими/новими модулями
  await env.SENTI_CACHE?.put(`lastPhoto:${chatId}`, best.file_id, { expirationTtl: 600 });
  await env.SENTI_CACHE?.put(`last_photo:${chatId}`, best.file_id, { expirationTtl: 600 });
  await tgSendMessage(env as any, chatId, "Фото отримав ✅ Тепер надішли коротку підказку текстом — що саме проаналізувати?");
}