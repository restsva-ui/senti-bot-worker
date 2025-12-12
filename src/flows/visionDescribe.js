// src/flows/visionDescribe.js
// Опис зображення з мультимовністю.
// Правки:
// 1) каскад за замовчуванням: gemini → cf (як у MODEL_ORDER_VISION)
// 2) додає мап-лінк при наявності координат
// 3) стабільний фолбек, якщо vision-провайдер відвалився

import { askVision } from "../lib/modelRouter.js";
import { t } from "../lib/i18n.js";
import { abs } from "../utils/url.js";

function buildMapsLink(env, lat, lon) {
  if (lat == null || lon == null) return "";
  const u = new URL("https://www.google.com/maps");
  u.searchParams.set("q", `${lat},${lon}`);
  const style = String(env.MAP_LINK_STYLE || "arrow").toLowerCase();
  if (style === "plain") return u.toString();
  // "arrow" — за замовч.
  return `→ ${u.toString()}`;
}

export async function visionDescribe(env, lang, { imageBase64, imageMime, caption = "", location = null }) {
  const order = env.MODEL_ORDER_VISION || "gemini:gemini-1.5-flash, cf:@cf/meta/llama-3.2-11b-vision-instruct";

  const systemHint =
    lang === "ru"
      ? "Опиши фото коротко (2–3 предложения). Без выдумок. Если не уверен — скажи."
      : lang === "en"
      ? "Describe the photo concisely (2–3 sentences). No fabrication. If uncertain, say so."
      : "Опиши фото коротко (2–3 речення). Без вигадок. Якщо не впевнений — скажи.";

  const userPrompt =
    caption && caption.trim()
      ? `${systemHint}\n\nПідпис користувача: ${caption}`
      : `${systemHint}\n\nОпиши, що на фото.`;

  try {
    const out = await askVision(env, order, userPrompt, {
      systemHint,
      imageBase64,
      imageMime,
      temperature: 0.4,
    });

    let extra = "";
    if (location?.latitude != null && location?.longitude != null) {
      const link = buildMapsLink(env, location.latitude, location.longitude);
      if (link) extra = `\n${link}`;
    }
    return String(out || "").trim() + extra;
  } catch (e) {
    const diag = String(env.DIAG_TAGS || "off").toLowerCase() === "on" ? `\n(diag: ${String(e?.message || e)})` : "";
    return (t(lang, "vision_unavailable") || "Vision тимчасово недоступний. Спробуй пізніше.") + diag;
  }
}