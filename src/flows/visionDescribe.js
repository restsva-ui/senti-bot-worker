// src/flows/visionDescribe.js
// Єдина точка для опису зображення з мультимовністю.
// Використання: const { text } = await describeImage(env, { chatId, tgLang, imageBase64, question, modelOrder });

import { askVision } from "../lib/modelRouter.js";
import { buildVisionHintByLang, makeVisionUserPrompt, postprocessVisionText } from "./visionPolicy.js";
import { getUserLang, setUserLang } from "../lib/langPref.js";

/**
 * @param {object} env - середовище Cloudflare Worker (з KV, токенами тощо)
 * @param {object} p
 * @param {string|number} p.chatId          - id чату (для KV-переваг)
 * @param {string} [p.tgLang]               - msg.from.language_code з Telegram
 * @param {string} p.imageBase64            - зображення у base64 (без префікса data:)
 * @param {string} [p.question]             - питання користувача (caption або текст)
 * @param {string} [p.modelOrder]           - ланцюжок моделей для vision (наприклад, "gemini:gemini-2.5-flash,@cf/meta/llama-3.2-11b-vision-instruct")
 * @returns {Promise<{ text: string }>}     - нормалізований текст відповіді
 */
export async function describeImage(env, { chatId, tgLang, imageBase64, question, modelOrder }) {
  // 1) Визначаємо/зберігаємо мову
  const lang = await getUserLang(env, chatId, tgLang);
  if (tgLang && tgLang.toLowerCase() !== lang) {
    // оновимо, якщо Telegram дав нову/іншу
    await setUserLang(env, chatId, tgLang);
  }

  // 2) Готуємо system hint та user prompt
  const systemHint = buildVisionHintByLang(lang);
  const userPrompt = makeVisionUserPrompt(question, lang);

  // 3) Викликаємо маршрутизатор моделей (vision)
  const out = await askVision(
    env,
    modelOrder,
    userPrompt,
    { systemHint, imageBase64, imageMime: "image/png", temperature: 0.2 }
  );

  // 4) Постпроцес і повернення
  return { text: postprocessVisionText(out) };
}
