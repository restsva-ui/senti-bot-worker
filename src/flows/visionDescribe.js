// src/flows/visionDescribe.js
import { askVision } from "../lib/modelRouter.js";
import { diagWrap } from "../lib/diag.js";

export const visionDescribe = diagWrap("visionDescribe", async ({ env, imageUrl, prompt, userLang }) => {
  const order =
    env.MODEL_ORDER_VISION ||
    "gemini:gemini-1.5-pro, cf:@cf/meta/llama-3.2-11b-vision-instruct";

  const sys =
    userLang === "ru"
      ? "Ты — помощник. Коротко и точно опиши изображение. Если есть текст — извлеки ключевое. Не выдумывай."
      : "Ти — помічник. Коротко і точно опиши зображення. Якщо є текст — витягни ключове. Не вигадуй.";

  const user = prompt || (userLang === "ru" ? "Опиши фото." : "Опиши фото.");

  const r = await askVision({
    env,
    order,
    system: sys,
    user,
    imageUrl,
  });

  return r;
});