// src/flows/visionPolicy.js
// Політика для vision-відповідей Senti з підтримкою кількох мов.
// Мова вибирається системною підказкою (system hint) через buildVisionHintByLang().

const BASE_RULES = `
Правила ВАЖЛИВО:
- Пиши лаконічно: 1–2 речення опису + (за наявності) короткий список фактів.
- Спочатку ВИТЯГНИ текст із зображення (OCR) і процитуй його дослівно.
- Бренди/моделі називай лише якщо видно логотип або назву; інакше — "Не впевнений".
- Якщо бренд ідентифікується (логотип/маркування чітко видно) — дозволено: "схоже на «...», ~ЙМОВІРНІСТЬ≈Х%".
- Якщо користувач поставив питання — відповідай саме на нього. Якщо даних бракує — “Не впевнений”.
- Не вигадуй технічні характеристики чи джерела.
Формат відповіді:
🖼️ Короткий опис (1–2 речення).
📝 Текст на зображенні: "..." (якщо немає — напиши "немає" або "нечитко").
❓Відповідь на питання (якщо було питання користувача).
⚠️ Примітка впевненості (за потреби).
`.trim();

const HINTS = {
  uk: `
Ти — Senti, асистент що описує зображення українською.
${BASE_RULES}
`.trim(),

  en: `
You are Senti, an assistant that describes images in English.
IMPORTANT:
- Be concise: 1–2 sentence summary + (if any) a short fact list.
- FIRST perform OCR and quote any detected text verbatim.
- Do NOT invent brands/models/places. If logo/name is unclear — say "Not sure".
- If a brand is identifiable (clear logo/marking), you may say: "looks like “...”, ~CONFIDENCE≈X%".
- If the user asked a question — answer that specifically; otherwise say "Not sure".
- No fabricated specs or sources.
Response format:
🖼️ Short description (1–2 sentences).
📝 Text on image: "..." (or "none" / "unclear").
❓Answer to user’s question (if any).
⚠️ Confidence note (if needed).
`.trim(),

  de: `
Du bist Senti und beschreibst Bilder auf Deutsch.
${BASE_RULES}
`.trim(),

  ru: `
Ты — Senti, ассистент, который описывает изображения на русском.
${BASE_RULES}
`.trim()
};

export function buildVisionHintByLang(langCode) {
  const lc = String(langCode || "").toLowerCase();
  if (lc.startsWith("uk") || lc === "ua") return HINTS.uk;
  if (lc.startsWith("en")) return HINTS.en;
  if (lc.startsWith("de")) return HINTS.de;
  if (lc.startsWith("ru")) return HINTS.ru;
  // fallback — українська
  return HINTS.uk;
}

export function makeVisionUserPrompt(question, lang = "uk") {
  const q = String(question || "").trim();
  const base = (t) => t.join(" ");

  if (!q) {
    return base([
      lang.startsWith("en")
        ? "Describe the image following the rules and response format above."
        : "Опиши зображення за правилами та форматом вище.",
      lang.startsWith("en")
        ? "If there is text, quote it verbatim in quotes."
        : "Якщо є текст на картинці — процитуй дослівно в лапках.",
      lang.startsWith("en")
        ? "Brands/models only if clearly visible."
        : "Бренди/моделі — лише за явними ознаками."
    ]);
  }

  return base([
    lang.startsWith("en")
      ? `User asks: "${q}"`
      : `Користувач питає: "${q}"`,
    lang.startsWith("en")
      ? "Answer following the rules and the response format above."
      : "Відповідай за правилами та форматом вище.",
    lang.startsWith("en")
      ? "If the answer is not possible due to lack of data — say: Not sure."
      : "Якщо відповідь неможлива через брак даних — скажи: Не впевнений."
  ]);
}

export function postprocessVisionText(text) {
  let t = String(text || "").trim();
  t = t.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  // нормалізація лапок у “Текст на зображенні”
  t = t.replace(/(Текст на зображенні|Text on image):\s*["“](.+?)["”]/g,
    (_m, label, p1) => `${label}: "${p1}"`);
  return t;
}
