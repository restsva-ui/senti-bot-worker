// src/flows/visionDescribe.js
// Єдина точка для опису зображення з мультимовністю.
// Правка: не показуємо "текст на зображенні", якщо юзер цього не питав.
// Правка: перша модель — gemini-2.5-flash.

import { askVision } from "../lib/modelRouter.js";
import {
  buildVisionHintByLang,
  makeVisionUserPrompt,
  postprocessVisionText,
} from "./visionPolicy.js";
import { getUserLang, setUserLang } from "../lib/langPref.js";

/** перевіряємо, чи юзер реально питав про текст/надпис */
function userAskedForText(q = "") {
  const s = q.toLowerCase();
  return (
    s.includes("текст") ||
    s.includes("написано") ||
    s.includes("що написано") ||
    s.includes("text on") ||
    s.includes("what is written")
  );
}

/** прибираємо блоки про текст, якщо вони не потрібні */
function stripOcrBlocks(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  for (const ln of lines) {
    const low = ln.toLowerCase().trim();
    if (
      low.startsWith("📝") ||
      low.startsWith("текст на зображенні") ||
      low.startsWith("text on the image") ||
      low.startsWith("text on image")
    ) {
      // пропускаємо
      continue;
    }
    out.push(ln);
  }
  // прибираємо дублікати рядків
  const uniq = [];
  const seen = new Set();
  for (const ln of out) {
    const key = ln.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(ln);
  }
  return uniq.join("\n").trim();
}

/**
 * @param {object} env
 * @param {object} p
 */
export async function describeImage(
  env,
  { chatId, tgLang, imageBase64, question, modelOrder }
) {
  // 1) мова
  const lang = await getUserLang(env, chatId, tgLang);
  if (tgLang && tgLang.toLowerCase() !== lang) {
    await setUserLang(env, chatId, tgLang);
  }

  // 2) підказки
  const systemHint = buildVisionHintByLang(lang);
  const userPrompt = makeVisionUserPrompt(question, lang);

  // 3) порядок моделей — оновлений
  const order =
    modelOrder ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";

  // 4) виклик
  const raw = await askVision(env, order, userPrompt, {
    systemHint,
    imageBase64,
    imageMime: "image/png",
    temperature: 0.2,
  });

  // 5) постпроцинг як у тебе
  let text = postprocessVisionText(raw);

  // якщо юзер НЕ питав про текст — прибираємо OCR-блоки
  if (!userAskedForText(question || "")) {
    text = stripOcrBlocks(text);
  }

  return { text };
}
