// src/flows/visionDescribe.js
// Єдина точка для опису зображення з мультимовністю.
//
// Правки:
// 1) каскад за замовчуванням: gemini:gemini-2.5-flash першим;
// 2) якщо юзер НЕ питав про текст — не показуємо "текст на зображенні";
// 3) прибрано дублікати рядків.
//
// Залежності, які у тебе є в репо:
// - ../lib/modelRouter.js  → askVision
// - ./visionPolicy.js      → buildVisionHintByLang, makeVisionUserPrompt, postprocessVisionText
//
// Немає залежності від ../lib/langPref.js — тут ми беремо мову з tgLang або fallback "uk".

import { askVision } from "../lib/modelRouter.js";
import {
  buildVisionHintByLang,
  makeVisionUserPrompt,
  postprocessVisionText,
} from "./visionPolicy.js";

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
    // ці заголовки прибираємо
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
 * Єдиний вхід для опису зображення.
 *
 * @param {object} env
 * @param {object} p
 * @param {string|number} p.chatId   - id чату (може знадобитись потім)
 * @param {string} [p.tgLang]        - мова телеграму, напр. "uk", "ru", "en"
 * @param {string} p.imageBase64     - картинка у base64
 * @param {string} [p.question]      - що саме спитав юзер
 * @param {string} [p.modelOrder]    - свій порядок моделей (опціонально)
 */
export async function describeImage(
  env,
  { chatId, tgLang, imageBase64, question, modelOrder }
) {
  // 1) визначаємо мову
  const lang = (tgLang && tgLang.toLowerCase()) || "uk";

  // 2) system + user
  const systemHint = buildVisionHintByLang(lang);
  const userPrompt = makeVisionUserPrompt(question, lang);

  // 3) каскад: за замовчуванням — gemini перша
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

  // 6) якщо юзер не просив саме про текст — прибираємо OCR-блок
  if (!userAskedForText(question || "")) {
    text = stripOcrBlocks(text);
  }

  return { text };
}
