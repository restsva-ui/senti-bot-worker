import { tgSendMessage } from "../../utils/telegram";

type EnvAll = { SENTI_CACHE?: KVNamespace };

// новий уніфікований ключ
const KEY_NEW = (chatId: number) => `lastPhoto2:${chatId}`;

// для сумісності зі старими назвами
const LEGACY_KEYS = (chatId: number) => [
  `lastPhoto:${chatId}`,
  `last_photo:${chatId}`,
  `photo:last:${chatId}`,
  `photos:last:${chatId}`,
  `tg:lastPhoto:${chatId}`,
];

export async function handlePhoto(update: any, env: EnvAll, chatId: number) {
  const photos = update?.message?.photo as { file_id: string }[] | undefined;
  const best = photos?.[photos.length - 1];
  if (!best?.file_id) return;

  // 1) пишемо новим форматом (JSON з timestamp)
  const payload = JSON.stringify({ file_id: best.file_id, ts: Date.now() });

  // TTL з запасом (10 хв), а вікно "свіжості" контролюємо у vision.ts
  await env.SENTI_CACHE?.put(KEY_NEW(chatId), payload, { expirationTtl: 600 });

  // 2) почистимо legacy-ключі, щоб не плутатися далі
  for (const k of LEGACY_KEYS(chatId)) {
    try { await env.SENTI_CACHE?.delete(k); } catch {}
  }

  // 3) підказка
  await tgSendMessage(
    env as any,
    chatId,
    "Фото отримав ✅ Тепер надішли коротку підказку текстом — що саме проаналізувати?"
  );
}