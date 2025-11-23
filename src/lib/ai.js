//////////////////////////////
// ai.js — тонка обгортка над modelRouter
//////////////////////////////

import { STATUTE_SENTI } from "../config/consts.js";
import { askText, askVision } from "./modelRouter.js";

// Формуємо промпт з урахуванням короткої історії діалогу
function formatDialog(dialog) {
  const lines = [];
  for (const turn of dialog) {
    if (!turn || !turn.role || !turn.content) continue;
    const prefix = turn.role === "user" ? "Користувач:" : "Senti:";
    lines.push(`${prefix} ${turn.content}`);
  }
  return lines.join("\n");
}

export async function aiRespond(env, dialog) {
  const prompt = formatDialog(dialog);
  const order = env.MODEL_ORDER_TEXT || env.MODEL_ORDER || "";
  const res = await askText(env, order, prompt, {
    systemHint: STATUTE_SENTI,
    temperature: 0.2,
  });
  return res?.text || "Не впевнений.";
}

export async function aiVision(env, imageBase64) {
  const order = env.MODEL_ORDER_VISION || env.MODEL_ORDER || "";
  const res = await askVision(env, order, "Проаналізуй це фото.", {
    systemHint: STATUTE_SENTI,
    imageBase64,
    temperature: 0.1,
  });
  return res?.text || "Не вдалося проаналізувати зображення.";
}
