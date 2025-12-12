// src/flows/handlePhoto.js
import { TG } from "../lib/tg.js";
import { askVision } from "../lib/modelRouter.js";

export async function handlePhoto(env, msg, lang = "uk") {
  const chatId = msg.chat.id;

  // беремо найбільше фото
  const photo = msg.photo?.[msg.photo.length - 1];
  if (!photo?.file_id) {
    await TG.sendMessage(chatId, t(lang), {}, env);
    return;
  }

  // 1. отримуємо файл з Telegram
  const file = await TG.getFile(env, photo.file_id);
  if (!file?.file_path) {
    throw new Error("TG file_path missing");
  }

  // 2. завантажуємо байти
  const url = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const imgRes = await fetch(url);
  const buffer = await imgRes.arrayBuffer();

  // 3. base64
  const base64 = btoa(
    String.fromCharCode(...new Uint8Array(buffer))
  );

  // 4. ❗ VISION — ТІЛЬКИ GEMINI
  const visionModelOrder = "gemini:gemini-1.5-flash";

  const prompt =
    lang === "ru"
      ? "Опиши изображение кратко и точно. Если не уверен — скажи."
      : lang === "en"
      ? "Describe the image briefly and accurately. If unsure, say so."
      : "Опиши зображення коротко і точно. Якщо не впевнений — скажи.";

  const text = await askVision(
    env,
    visionModelOrder,
    prompt,
    {
      imageBase64: base64,
      imageMime: "image/jpeg",
      systemHint: "You are a vision assistant."
    }
  );

  await TG.sendMessage(chatId, text, {}, env);
}

function t(lang) {
  if (lang === "ru") return "Не вдалося отримати фото.";
  if (lang === "en") return "Could not read the photo.";
  return "Не вдалося отримати фото.";
}