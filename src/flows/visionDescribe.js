// src/flows/visionDescribe.js
// Опис зображення + проба виявлення місця (PLACE=...) і лінк на Google Maps.

import { askVision } from "../lib/modelRouter.js";
import { buildVisionHintByLang, makeVisionUserPrompt } from "./visionPolicy.js";

function buildMapsLink(placeText) {
  const q = encodeURIComponent(String(placeText || "").trim());
  if (!q) return "";
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export async function visionDescribe(env, lang, imageUrl, userQuestion = "") {
  const hint = buildVisionHintByLang(lang);
  const userPrompt = makeVisionUserPrompt(userQuestion);

  const res = await askVision(env, { imageUrl, systemHint: hint, userPrompt });
  let text = String(res?.text || "").trim();
  if (!text) return "Не впевнений.";

  // Спроба виділити PLACE=...
  let place = "";
  const m = text.match(/^\s*PLACE\s*=\s*(.+?)\s*$/mi);
  if (m) {
    place = m[1].trim();
    // приберемо техрядок PLACE= з основного тексту, щоб не світити сирим
    text = text.replace(m[0], "").replace(/\n{2,}/g, "\n").trim();
  }

  if (place) {
    const maps = buildMapsLink(place);
    text += `\n\n📍 Місце/орієнтир: ${place}\n🔗 Карта: ${maps}`;
  }
  return text;
}
