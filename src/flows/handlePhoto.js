// src/flows/handlePhoto.js

import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { visionDescribe } from "./visionDescribe.js";
import { getVisionFlags, buildVisionPrompt } from "./visionPolicy.js";
import { TG } from "../lib/tg.js";

const {
  ADMIN,
  mainKeyboard,
} = TG;

// Допоміжна функція для вибору найбільшого фото
function pickLargestPhoto(photo = []) {
  if (!Array.isArray(photo) || !photo.length) return null;
  return photo.slice().sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
}

export async function handlePhoto(env, msg, lang) {
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  const isAdmin = ADMIN(env, msg?.from?.id, msg?.from?.username);

  const ph = pickLargestPhoto(msg.photo);
  if (!ph?.file_id) {
    await TG.sendMessage(chatId, "Фото не знайдено в повідомленні.", { reply_markup: mainKeyboard(isAdmin) }, env);
    return;
  }

  // Забираємо файл через Telegram
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  const file = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(ph.file_id)}`).then(r => r.json());
  const filePath = file?.result?.file_path;
  if (!filePath) {
    await TG.sendMessage(chatId, "Не зміг отримати файл з Telegram.", { reply_markup: mainKeyboard(isAdmin) }, env);
    return;
  }

  const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const bin = await fetch(fileUrl).then(r => r.arrayBuffer());
  const b64 = btoa(String.fromCharCode(...new Uint8Array(bin)));
  const mime = "image/jpeg";

  const { wantOcr, wantLandmarks } = getVisionFlags(env);
  const systemHint = buildVisionPrompt(lang, { wantLandmarks, wantOcr });

  const caption = String(msg.caption || "");
  const location = msg.location || null;

  const out = await visionDescribe(env, lang, {
    imageBase64: b64,
    imageMime: mime,
    caption,
    location,
    systemHint,
  });

  await TG.sendMessage(chatId, out, { reply_markup: mainKeyboard(isAdmin) }, env);
}