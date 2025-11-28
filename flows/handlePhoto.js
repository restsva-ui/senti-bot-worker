// src/flows/handlePhoto.js

import { getUserTokens } from "../lib/userDrive.js";
import { abs } from "../utils/url.js";
import { getEnergy, spendEnergy } from "../lib/energy.js";
import { t } from "../lib/i18n.js";
import { TG } from "../lib/tg.js";
import { driveSaveFromUrl } from "../lib/drive.js";
import { describeImage } from "./visionDescribe.js";
import { pickReplyLanguage } from "../lib/i18n.js";
import { pickPhoto } from "../lib/telegram.js";
import { pickFilenameByLang } from "../lib/codexTemplates.js";

const {
  energyLinks,
  sendPlain,
  mainKeyboard,
} = TG;

export async function handlePhoto(update, tgContext) {
  const env = tgContext.env;
  const msg = update.message;
  const chatId = msg?.chat?.id;
  const userId = msg?.from?.id;
  const userLang = msg?.from?.language_code || "uk";
  let lang = pickReplyLanguage(msg);

  // Чи drive режим?
  const driveOn = await TG.getDriveMode(env, userId);
  const photo = pickPhoto(msg);
  if (!photo) {
    await sendPlain(env, chatId, "Не вдалося знайти фото у повідомленні.");
    return new Response("OK");
  }

  // Якщо drive ON — зберігаємо на Google Drive
  if (driveOn) {
    let hasTokens = false;
    try {
      const tokens = await getUserTokens(env, userId);
      hasTokens = !!tokens;
    } catch {}
    if (!hasTokens) {
      const connectUrl = abs(env, "/auth/drive");
      await sendPlain(
        env,
        chatId,
        t(lang, "drive_connect_hint") ||
          "Щоб зберігати файли, підключи Google Drive.",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Підключити Drive", url: connectUrl }],
            ],
          },
        }
      );
      return new Response("OK");
    }

    const cur = await getEnergy(env, userId);
    const need = Number(cur.costImage ?? 5);
    if ((cur.energy ?? 0) < need) {
      const links = energyLinks(env, userId);
      await sendPlain(
        env,
        chatId,
        t(lang, "need_energy_media", need, links.energy)
      );
      return new Response("OK");
    }
    await spendEnergy(env, userId, need, "media");

    const url = await TG.tgFileUrl(env, photo.file_id);
    const saved = await driveSaveFromUrl(env, userId, url, photo.name);
    await sendPlain(
      env,
      chatId,
      `✅ Збережено на Диск: ${saved?.name || photo.name}`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Відкрити Диск",
                url: "https://drive.google.com/drive/my-drive",
              },
            ],
          ],
        },
      }
    );
    return new Response("OK");
  }

  // Vision-режим (генеруємо опис зображення)
  const cur = await getEnergy(env, userId);
  const need = Number(cur.costText ?? 1);
  if ((cur.energy ?? 0) < need) {
    const links = energyLinks(env, userId);
    await sendPlain(
      env,
      chatId,
      t(lang, "need_energy_text", need, links.energy)
    );
    return new Response("OK");
  }
  await spendEnergy(env, userId, need, "vision");

  const url = await TG.tgFileUrl(env, photo.file_id);
  const imageBase64 = await TG.urlToBase64(url);
  const prompt =
    msg?.caption ||
    (lang.startsWith("uk")
      ? "Опиши, що на зображенні, коротко і по суті."
      : "Describe the image briefly and to the point.");

  try {
    const { text } = await describeImage(env, {
      chatId,
      tgLang: msg.from?.language_code,
      imageBase64,
      question: prompt,
      modelOrder: "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct",
    });
    await sendPlain(env, chatId, `🖼️ ${text}`);
  } catch (e) {
    await sendPlain(env, chatId, "Поки що не можу проаналізувати фото.");
  }

  return new Response("OK");
}
