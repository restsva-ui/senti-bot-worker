// src/flows/visionDescribe.js
// Єдина точка для опису зображення з мультимовністю.
// Тепер каскад за замовчуванням: спершу Gemini, потім CF.

import { askVision } from "../lib/modelRouter.js";
import {
  buildVisionHintByLang,
  makeVisionUserPrompt,
  postprocessVisionText,
} from "./visionPolicy.js";
import { getUserLang, setUserLang } from "../lib/langPref.js";

/**
 * @param {object} env
 * @param {object} p
 * @param {string|number} p.chatId
 * @param {string} [p.tgLang]
 * @param {string} p.imageBase64
 * @param {string} [p.question]
 * @param {string} [p.modelOrder] - можна явно передати свій порядок
 */
export async function describeImage(
  env,
  { chatId, tgLang, imageBase64, question, modelOrder }
) {
  // 1) визначаємо мову
  const lang = await getUserLang(env, chatId, tgLang);
  if (tgLang && tgLang.toLowerCase() !== lang) {
    await setUserLang(env, chatId, tgLang);
  }

  // 2) system + user
  const systemHint = buildVisionHintByLang(lang);
  const userPrompt = makeVisionUserPrompt(question, lang);

  // 3) каскад: якщо не передали — беремо gemini першим
  const order =
    modelOrder ||
    "gemini:gemini-1.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";

  // 4) виклик
  const out = await askVision(env, order, userPrompt, {
    systemHint,
    imageBase64,
    imageMime: "image/png",
    temperature: 0.2,
  });

  // 5) постпроц
  return { text: postprocessVisionText(out) };
}