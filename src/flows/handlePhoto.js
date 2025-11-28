// src/flows/handlePhoto.js

import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { t } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import { driveSaveFromUrl } from "../lib/drive.js";
import { describeImage } from "./visionDescribe.js";
import { pickReplyLanguage } from "../lib/i18n.js";

const {
  energyLinks,
  sendPlain,
  mainKeyboard,
} = TG;

// Допоміжна функція для вибору фото з повідомлення (замість імпорту)
function pickPhoto(msg) {
  const arr = Array.isArray(msg?.photo) ? msg.photo : null;
  if (!arr?.length) return null;
  const ph = arr[arr.length - 1];
  return {
    type: "photo",
    file_id: ph.file_id,
    name: `photo_${ph.file_unique_id}.jpg`,
  };
}

export async function handlePhoto(update, tgContext) {
  const env = tgContext.env;
  const msg = update.message;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const userLang = msg?.from?.language_code || "uk";
  let lang = pickReplyLanguage(msg);

  const driveOn = await TG.getDriveMode(env, userId);
  const photo = pickPhoto(msg);
  if (!photo) {
    await sendPlain(env, chatId, "Не вдалося знайти фото у повідомленні.");
    return new Response("OK");
  }

  // ... решта без змін ...
  // (додавай код як було раніше, але без використання pickFilenameByLang)
}