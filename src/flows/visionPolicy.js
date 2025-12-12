// src/flows/visionPolicy.js
// Політика vision-відповідей Senti з підтримкою кількох мов.
// ВАЖЛИВО: тепер OCR не примушується (щоб не ламати відповіді),
// але можна увімкнути через env.VISION_OCR="on" якщо треба.

import { t } from "../lib/i18n.js";

export function buildVisionPrompt(lang, { wantLandmarks = true, wantOcr = false } = {}) {
  const ocr = wantOcr
    ? lang === "ru"
      ? "Если на фото есть читаемый текст — выпиши его кратко."
      : lang === "en"
      ? "If there is readable text in the image, extract it briefly."
      : "Якщо на фото є читабельний текст — коротко випиши його."
    : "";

  const lm = wantLandmarks
    ? lang === "ru"
      ? "Если видишь известное место/объект — назови его и скажи, в каком городе/стране это может быть."
      : lang === "en"
      ? "If you recognize a landmark/place, name it and say what city/country it might be."
      : "Якщо бачиш відоме місце/обʼєкт — назви його і вкажи місто/країну, якщо можеш."
    : "";

  if (lang === "ru") {
    return [
      "Опиши фото коротко (2–3 предложения).",
      "Не выдумывай деталей.",
      "Если не уверен — скажи 'Не уверен'.",
      lm,
      ocr,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (lang === "en") {
    return [
      "Describe the photo concisely (2–3 sentences).",
      "Do not fabricate details.",
      "If uncertain, say 'I'm not sure'.",
      lm,
      ocr,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Опиши фото коротко (2–3 речення).",
    "Не вигадуй деталей.",
    "Якщо не впевнений — скажи 'Не впевнений'.",
    lm,
    ocr,
  ]
    .filter(Boolean)
    .join("\n");
}
export function getVisionFlags(env) {
  const ocrOn = String(env.VISION_OCR || "off").toLowerCase() === "on";
  const landmarksOff = String(env.VISION_LANDMARKS || "on").toLowerCase() === "off";
  return {
    wantOcr: ocrOn,
    wantLandmarks: !landmarksOff,
  };
}

export function visionFallbackText(lang) {
  return t(lang, "vision_unavailable") || (lang === "ru"
    ? "Vision временно недоступен. Попробуй позже."
    : lang === "en"
    ? "Vision is temporarily unavailable. Please try again later."
    : "Vision тимчасово недоступний. Спробуй пізніше.");
}