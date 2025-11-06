// src/flows/visionDescribe.js
// Єдина точка для опису зображення з мультимовною політикою.

import { askVision } from "../lib/modelRouter.js";
import { buildVisionHintByLang, makeVisionUserPrompt, postprocessVisionText } from "./visionPolicy.js";
import { getUserLang, setUserLang } from "../lib/langPref.js";

/**
 * describeImage()
 * @param {object} env
 * @param {object} p
 * @param {string|number} p.chatId
 * @param {string} [p.tgLang]
 * @param {string} p.imageBase64
 * @param {string} [p.question]
 * @param {string} [p.modelOrder]
 */
export async function describeImage(env, p = {}) {
  const {
    chatId,
    tgLang,
    imageBase64,
    question = "",
    modelOrder = ""
  } = p;

  if (!imageBase64) {
    throw new Error("describeImage: imageBase64 is required");
  }

  // 1) мова
  let lang = tgLang;
  if (!lang && chatId) {
    try {
      lang = await getUserLang(env, chatId);
    } catch {
      lang = null;
    }
  }
  if (!lang) lang = "uk";

  // 2) зберігаємо мовну перевагу
  if (chatId && lang) {
    try { await setUserLang(env, chatId, lang); } catch {}
  }

  // 3) системна підказка + юзерський промпт
  const systemHint = buildVisionHintByLang(lang);
  const userPrompt = makeVisionUserPrompt(question, lang);

  // 4) виклик каскаду vision-моделей
  const out = await askVision(
    env,
    modelOrder,
    userPrompt,
    {
      systemHint,
      imageBase64,
      imageMime: "image/png",
      temperature: 0.15
    }
  );

  // 5) постпроцес
  const text = postprocessVisionText(out);
  return { text, lang };
}
