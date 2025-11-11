// src/flows/visionDescribe.js
// Єдина точка для опису зображення з мультимовністю.
//
// Правки:
// 1) каскад за замовчуванням: gemini:gemini-2.5-flash першим;
// 2) якщо юзер НЕ питав про текст — не показуємо "текст на зображенні";
// 3) прибрано дублікати рядків;
// 4) мова зберігається/читається з KV через src/lib/langPref.js

import { askVision } from "../lib/modelRouter.js";
import {
  buildVisionHintByLang,
  makeVisionUserPrompt,
  postprocessVisionText,
} from "./visionPolicy.js";
import { getUserLang, setUserLang } from "../lib/langPref.js";

// чи юзер явно просив прочитати текст/надпис
function userAskedForText(q = "") {
  const s = q.toLowerCase();
  return (
    s.includes("текст") ||
    s.includes("що написано") ||
    s.includes("надпис") ||
    s.includes("написи") ||
    s.includes("text on") ||
    s.includes("what is written") ||
    s.includes("read the text")
  );
}

// прибираємо OCR-блоки, якщо вони не потрібні
function stripOcrBlocks(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  for (const ln of lines) {
    const low = ln.trim().toLowerCase();
    if (
      low.startsWith("📝") ||
      low.startsWith("текст на зображенні") ||
      low.startsWith("text on the image") ||
      low.startsWith("text on image")
    ) {
      continue;
    }
    out.push(ln);
  }
  // прибираємо дублікати
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
  // 1) визначаємо мову: KV → tgLang → "uk"
  const lang = await getUserLang(env, chatId, tgLang);
  // якщо телеграм дав нову мову — оновимо KV
  if (tgLang && tgLang.toLowerCase() !== lang) {
    await setUserLang(env, chatId, tgLang);
  }

  // 2) system + user
  const systemHint = buildVisionHintByLang(lang);
  const userPrompt = makeVisionUserPrompt(question, lang);

  // 3) каскад: тепер перша — gemini 2.5 flash
  const order =
    modelOrder ||
    "gemini:gemini-2.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";

  // 4) виклик моделі
  const out = await askVision(env, order, userPrompt, {
    systemHint,
    imageBase64,
    imageMime: "image/png",
    temperature: 0.2,
  });

  // 5) постпроц
  let text = postprocessVisionText(out);

  // якщо юзер не питав про текст — прибираємо OCR-блоки
  if (!userAskedForText(question || "")) {
    text = stripOcrBlocks(text);
  }

  return { text };
}
 
