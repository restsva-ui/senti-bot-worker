// src/flows/visionPolicy.js
// Політика для vision-відповідей Senti з підтримкою кількох мов.
// ВАЖЛИВО: OCR не обовʼязковий — витягуємо текст тільки якщо юзер про це попросив
// або якщо запит явно про текст/написи.

const BASE_RULES = `
Правила ВАЖЛИВО:
- Пиши лаконічно: 1–2 речення опису + (за потреби) 1 коротка відповідь на запитання.
- Якщо користувач прямо просив про текст/надпис/що написано — тоді витягни текст із зображення (OCR) і процитуй його дослівно в лапках.
- Якщо про текст НЕ питали — не додавай розділ про текст.
- Бренди/моделі називай лише якщо видно логотип або назву; інакше — "Не впевнений".
- Якщо даних недостатньо — відповідай "Не впевнений".
Формат відповіді (базовий):
🖼️ Короткий опис (1–2 речення).
(Опційно) 📝 Текст на зображенні: "..."
(Опційно) ❓Відповідь на питання.
`.trim();

const HINTS = {
  uk: `
Ти — Senti, асистент що описує зображення українською.
${BASE_RULES}
`.trim(),

  en: `
You are Senti, an assistant that describes images in English.
IMPORTANT:
- Be concise: 1–2 sentence summary.
- Only extract/quote text (OCR) if the user explicitly asked for text/labels.
- Do not invent brands/models/places.
- If data is insufficient — say "Not sure."
Response format (base):
🖼️ Short description (1–2 sentences).
(Optional) 📝 Text on image: "..."
(Optional) ❓Answer to user's question.
`.trim(),

  de: `
Du bist Senti und beschreibst Bilder auf Deutsch.
${BASE_RULES}
`.trim(),

  ru: `
Ты — Senti, ассистент, который описывает изображения на русском.
${BASE_RULES}
`.trim(),
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

// чи це запит про текст
function isTextQuery(q = "") {
  const s = q.toLowerCase();
  return (
    s.includes("текст") ||
    s.includes("надпис") ||
    s.includes("написи") ||
    s.includes("що написано") ||
    s.includes("text") ||
    s.includes("label") ||
    s.includes("what is written")
  );
}

export function makeVisionUserPrompt(question, lang = "uk") {
  const q = String(question || "").trim();
  const base = (t) => t.join(" ");
  const needsText = isTextQuery(q);

  // якщо користувач просто надіслав фото без питання
  if (!q) {
    return base([
      lang.startsWith("en")
        ? "Describe the image following the rules and base response format above."
        : "Опиши зображення за правилами та базовим форматом вище.",
      lang.startsWith("en")
        ? "Do NOT add OCR/text section unless the user asked about text."
        : "НЕ додавай розділ з текстом, якщо користувач не питав про текст.",
      lang.startsWith("en")
        ? "Brands/models only if clearly visible."
        : "Бренди/моделі — лише за явними ознаками.",
    ]);
  }

  // є конкретне питання
  return base([
    lang.startsWith("en")
      ? `User asks: "${q}"`
      : `Користувач питає: "${q}"`,
    lang.startsWith("en")
      ? "Answer following the rules and the base response format above."
      : "Відповідай за правилами та базовим форматом вище.",
    needsText
      ? lang.startsWith("en")
        ? "User asked about text — extract and quote text from the image."
        : "Користувач питає про текст — витягни й процитуй текст з зображення."
      : lang.startsWith("en")
      ? "User did NOT ask about text — do not add OCR section."
      : "Користувач не питав про текст — не додавай розділ з текстом.",
    lang.startsWith("en")
      ? "If the answer is not possible due to lack of data — say: Not sure."
      : "Якщо відповідь неможлива через брак даних — скажи: Не впевнений.",
  ]);
}

export function postprocessVisionText(text) {
  let t = String(text || "").trim();

  // прибираємо зайві \r і надмірні переноси
  t = t
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  // нормалізація підпису "Текст на зображенні"
  t = t.replace(
    /(Текст на зображенні|Text on image):\s*["“](.+?)["”]/g,
    (_m, label, p1) => `${label}: "${p1}"`
  );

  // прибирання дублів рядків
  const lines = t.split("\n");
  const seen = new Set();
  const out = [];
  for (const ln of lines) {
    const key = ln.trim();
    if (!key) {
      out.push(ln);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ln);
  }

  return out.join("\n").trim();
}
