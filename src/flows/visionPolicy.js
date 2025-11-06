// src/flows/visionPolicy.js
// Політика для vision-відповідей Senti з підтримкою кількох мов.

const BASE_RULES = `
Правила ВАЖЛИВО:
- Пиши лаконічно: 1–2 речення опису + (за потреби) короткі факти.
- Зроби OCR. Якщо текст Є — наведи його дослівно в лапках у окремому рядку.
  Якщо тексту немає або він нерозбірливий — просто НЕ згадуй про "текст".
- Бренди/моделі/місця називай лише за чіткими ознаками (логотип, назва, упізнаваний об’єкт).
  Інакше — "Не впевнений".
- Якщо ідентифікація ймовірна, але не 100% — використовуй формулювання типу: "схоже на …".
- Відповідай саме на питання користувача; якщо даних бракує — "Не впевнений".
- Не вигадуй характеристики, координати, посилання чи джерела.
- НІКОЛИ не пиши, що ти ШІ/модель або чиєсь API.
- Формат (фолбек-текст для не-JSON):
  🟡 Короткий опис (1–2 речення).
  Текст на зображенні: "..." ← тільки якщо він Є.
  ❓Відповідь на питання (якщо було).
  ⚠️ Примітка впевненості (опційно).
`.trim();

const HINTS = {
  uk: `
Ти — Senti, асистент що описує зображення українською. Уникай шаблонів і згадки про те, що ти ШІ.
${BASE_RULES}
`.trim(),
  en: `
You are Senti, an assistant that describes images in English. Do not mention being an AI or a model.
IMPORTANT:
- Be concise: 1–2 sentence summary + optional short facts.
- Perform OCR; if text EXISTS, quote it verbatim in quotes on a separate line.
  If no text — omit this line entirely.
- Name brands/models/places only with clear evidence; otherwise say "Not sure".
- If identification is probable but not certain, use phrasing like "looks like …".
- Answer the user's question if present; if insufficient data — say "Not sure".
- Do not fabricate specs, coordinates or links.
Response fallback format (non-JSON):
  🟡 Short description (1–2 sentences).
  Text on image: "..." ← only if it EXISTS.
  ❓Answer (if any).
  ⚠️ Confidence note (optional).
`.trim(),
  de: `
Du bist Senti und beschreibst Bilder auf Deutsch. Erwähne niemals, dass du eine KI bist.
${BASE_RULES}
`.trim(),
  ru: `
Ты — Senti, описываешь изображения на русском. Не упоминай, что ты ИИ/модель.
${BASE_RULES}
`.trim(),
};

export function buildVisionHintByLang(langCode) {
  const lc = String(langCode || "").toLowerCase();
  if (lc.startsWith("uk") || lc === "ua") return HINTS.uk;
  if (lc.startsWith("en")) return HINTS.en;
  if (lc.startsWith("de")) return HINTS.de;
  if (lc.startsWith("ru")) return HINTS.ru;
  return HINTS.uk;
}

// нормальний escape
function escHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
export function makeVisionUserPrompt(question, lang = "uk") {
  const q = String(question || "").trim();
  const isEn = lang.startsWith("en");

  if (!q) {
    return isEn
      ? [
          "Describe the image following the rules above.",
          "If and only if there is text on the image, quote it verbatim in quotes on a separate line starting with 'Text on image:'. If no text — omit this line entirely.",
          "Mention brands/models/places only if clearly visible; otherwise say 'Not sure'.",
        ].join(" ")
      : [
          "Опиши зображення за правилами вище.",
          "Якщо і тільки якщо на зображенні є текст, наведи його дослівно в лапках окремим рядком, що починається з 'Текст на зображенні:'. Якщо тексту немає — цей рядок пропусти.",
          "Бренди/моделі/місця вказуй лише за чіткими ознаками; інакше — 'Не впевнений'.",
        ].join(" ");
  }

  return isEn
    ? [
        `User asks: "${q}"`,
        "Answer following the rules above. Do not mention being an AI.",
        "If insufficient data — say: Not sure.",
        "If and only if text exists on the image, add a separate line: 'Text on image: \"...\"'. If no text — omit that line entirely.",
      ].join(" ")
    : [
        `Користувач питає: "${q}"`,
        "Відповідай за правилами вище. Не згадуй, що ти ШІ чи модель.",
        "Якщо бракує даних — скажи: Не впевнений.",
        "Якщо і тільки якщо на зображенні є текст, додай окремий рядок: 'Текст на зображенні: \"...\"'. Якщо тексту немає — цей рядок пропусти.",
      ].join(" ");
}

export function postprocessVisionText(text) {
  let t = String(text || "").trim();

  t = t.replace(/^[ \t]*(?:—|--)?\s*via\s+[^\n]*\n?/gim, "");
  t = t
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  t = t.replace(
    /(Текст на зображенні|Text on image):\s*["“](.+?)["”]/g,
    (_m, label, p1) => `${label}: "${p1}"`
  );

  t = t
    .replace(
      /^(?:\s*)?(Текст на зображенні|Text on image):\s*(“|")?(немає|нечитко|відсутній|none|no text|unclear|not readable|unreadable)(”|")?\.*\s*$/gim,
      ""
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const lines = t.split(/\n+/).filter(Boolean);
  if (lines.length > 4) {
    t = lines.slice(0, 4).join("\n");
  }

  return t;
}
