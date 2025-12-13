// src/flows/visionDescribe.js
// Опис фото через Vision-моделі (Gemini / CF Vision) з акуратним фолбеком

import { getFile } from "../lib/tg.js";
import { askVisionDiag, safeTrimAnswer } from "../lib/modelRouter.js";

function pickBestPhoto(photoArr) {
  const arr = Array.isArray(photoArr) ? photoArr : [];
  if (!arr.length) return null;

  // Telegram дає кілька розмірів; беремо найбільший (width*height, або file_size)
  return arr
    .slice()
    .sort((a, b) => {
      const aa = (a.width || 0) * (a.height || 0);
      const bb = (b.width || 0) * (b.height || 0);
      if (aa !== bb) return bb - aa;
      return (b.file_size || 0) - (a.file_size || 0);
    })[0];
}

function tgFileUrl(env, filePath) {
  const token = env?.TELEGRAM_BOT_TOKEN || env?.TG_BOT_TOKEN || env?.BOT_TOKEN;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN (or TG_BOT_TOKEN)");
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

export async function visionDescribe({ env, photo, caption = "" }) {
  const best = pickBestPhoto(photo);
  if (!best?.file_id) throw new Error("No photo file_id");

  // 1) дізнаємось file_path
  const file = await getFile(best.file_id, env);
  const filePath = file?.result?.file_path;
  if (!filePath) throw new Error("Telegram getFile: missing file_path");

  // 2) будуємо URL до файлу
  const imageUrl = tgFileUrl(env, filePath);

  // 3) prompt (коротко, без вигадок; 2-3 речення + якщо є текст на фото — витягнути)
  const prompt =
    "Опиши, що на фото, українською, 2–3 речення, без вигадок. " +
    "Якщо на фото є читабельний текст — процитуй його коротко. " +
    (caption ? `\nПідпис користувача: ${caption}` : "");

  const out = await askVisionDiag(env, prompt, imageUrl, { temperature: 0.2 });
  return safeTrimAnswer(out, 2500);
}