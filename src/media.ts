import { analyzeImage } from "./ai/providers.js";
import { tgGetFileUrl } from "./adapters/telegram.js";

export async function handlePhotoMessage(update, env) {
  const msg = update.message;
  const photos = msg.photo || [];
  if (!photos.length) return "Фото не знайдено.";
  // Найбільший розмір — останній елемент
  const fileId = photos[photos.length - 1].file_id;
  const url = await tgGetFileUrl(fileId, env);

  const caption = (msg.caption || "").trim();
  const prompt = caption || "Опиши зображення і зроби короткі висновки як для користувача.";
  return await analyzeImage(prompt, [url], env);
}
