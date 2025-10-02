// src/utils/i18n.ts

/**
 * Підтримувані мови.
 */
export type Lang = "uk" | "ru" | "de" | "en";

/** Людська назва мови (для логів/діагностики). */
export function langName(lang: Lang): string {
  switch (lang) {
    case "uk":
      return "Українська";
    case "ru":
      return "Русский";
    case "de":
      return "Deutsch";
    case "en":
    default:
      return "English";
  }
}

/* ====================== евристики/ознаки ====================== */

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;

const RU_LETTERS = /[ёыэ]/i;         // характерні для RU
const UK_LETTERS = /[ієїґ]/i;        // характерні для UK
const DE_DIACRITICS = /[äöüß]/i;     // характерні для DE

// Короткі слова (жорсткий мапінг на мову)
const SHORT_MAP: Record<Lang, string[]> = {
  uk: ["так", "ні", "ок", "окей", "привіт", "йо", "гаразд"],
  ru: ["да", "нет", "ок", "окей", "привет"],
  de: ["ja", "nein", "hallo", "servus", "moin"],
  en: ["ok", "okay", "yes", "no", "hi", "hey", "hello"],
};

// Поширені слова/корені (бал за «схожість»)
const RU_COMMON =
  /\b(да|нет|что|это|как|когда|почему|например|данн|сервер|сеть|основн|котор|пользовател[ья])\b/i;
const UK_COMMON =
  /\b(так|ні|що|це|як|коли|чому|наприклад|дан(их|і)|сервер|мереж|основн|який|користувач)\b/i;
const DE_COMMON =
  /\b(ja|nein|und|ist|nicht|ein|eine|einem|einer|warum|wie|mit|für|zum|zur|bitte|kurz|beispiel|dass|sind|gerne|möchte|moechte|vielleicht|deshalb|darum|netzwerk|server|inhalt)\b/i;
const EN_COMMON =
  /\b(ok(?:ay)?|yes|no|and|is|are|what|why|how|with|for|user?s?|please|quick|hello|hi|hey|network|server|content|thanks?)\b/i;

/** Прибираємо службову команду з початку тексту. */
function stripCommand(raw: string): string {
  let t = (raw || "").trim();
  t = t.replace(/^\/[a-zA-Z_]+(?:@[A-Za-z0-9_]+)?\s*/i, "");
  t = t.replace(/^[:\-–—]\s*/, "");
  return t.trim();
}

/* ====================== інструкції стилю ====================== */

/**
 * Єдина «ядрова» інструкція: однакова для Gemini й OpenRouter.
 * Важливо: жорстка заборона мета-коментарів про мови.
 */
export function composeSystemInstruction(lang: Lang): string {
  const common =
    "Правила: відповідай ТІЛЬКИ вибраною мовою; не перекладай і не пояснюй інші мови; " +
    "не коментуй, якою мовою був запит; навіть якщо запит дуже короткий або іншою мовою — " +
    "відповідай повністю обраною мовою. Пиши дружньо, природно, короткими простими реченнями, " +
    "без канцеляризмів і без преамбул на кшталт «я ШІ/ИИ/KI». Якщо просять список — використовуй маркери.";

  switch (lang) {
    case "uk":
      return `Відповідай українською мовою. ${common}`;
    case "ru":
      return `Отвечай на русском языке. ${common}`;
    case "de":
      return `Antworte ausschließlich auf Deutsch. ${common}`
        .replace("дружньо, природно", "locker und freundlich")
        .replace("короткими простими реченнями", "in kurzen, klaren Sätzen");
    case "en":
    default:
      return `Answer exclusively in English. ${common}`
        .replace("дружньо, природно", "friendly and natural")
        .replace("короткими простими реченнями", "in short, clear sentences");
  }
}

/* ====================== визначення мови ====================== */

/**
 * Нормалізація/визначення мови за текстом.
 *
 * Пріоритети:
 * 1) Якщо збіг із SHORT_MAP (типові короткі слова) — повертаємо відповідну мову.
 * 2) Інакше скоримо текст за літерами/частими словами та домінуванням скрипту.
 * 3) Якщо різниця між топ-2 мовами достатня (>= 0.4) — беремо переможця.
 * 4) Якщо неоднозначно, але видно домінування скрипту — вибираємо всередині пари (uk/ru або en/de).
 * 5) Якщо взагалі немає ознак — беремо Telegram language_code, інакше — 'en'.
 */
export function normalizeLang(input: string, tgLanguageCode?: string): Lang {
  const t = stripCommand(input);
  const lowered = t.toLowerCase();

  // 1) Жорстке розпізнавання коротких/типових слів
  const single = lowered.replace(/[^\p{L}]+/gu, " ").trim();
  if (single.length > 0) {
    for (const lang of Object.keys(SHORT_MAP) as Lang[]) {
      for (const w of SHORT_MAP[lang]) {
        if (new RegExp(`\\b${w}\\b`, "i").test(single)) return lang;
      }
    }
  }

  // 2) Дуже короткий текст — дивимось на TG або EN
  if (t.length < 3) {
    const tg = (tgLanguageCode || "").split("-")[0].toLowerCase() as Lang | "";
    return (["uk", "ru", "de", "en"] as Lang[]).includes(tg) ? tg : "en";
  }

  // 3) Підрахунок скриптів
  let latinCount = 0;
  let cyrCount = 0;
  for (const ch of t) {
    if (LATIN.test(ch)) latinCount++;
    else if (CYRILLIC.test(ch)) cyrCount++;
  }

  // 4) Бал за ознаки
  const score: Record<Lang, number> = { uk: 0, ru: 0, de: 0, en: 0 };

  if (UK_LETTERS.test(t)) score.uk += 3.0;
  if (RU_LETTERS.test(t)) score.ru += 3.0;
  if (DE_DIACRITICS.test(t)) score.de += 2.2;

  if (UK_COMMON.test(t)) score.uk += 1.8;
  if (RU_COMMON.test(t)) score.ru += 1.8;
  if (DE_COMMON.test(t)) score.de += 1.6;
  if (EN_COMMON.test(t)) score.en += 1.6;

  if (cyrCount > latinCount * 1.15) {
    score.uk += 1.2;
    score.ru += 1.2;
  } else if (latinCount > cyrCount * 1.15) {
    score.en += 1.0;
    score.de += 0.9;
    if (!DE_DIACRITICS.test(t)) score.en += 0.3; // латиниця без умлаутів — схиляємо до EN
  }

  // 5) Вибір переможця
  const order = (["uk", "ru", "de", "en"] as Lang[])
    .map((l) => [l, score[l]] as const)
    .sort((a, b) => b[1] - a[1]);

  const [winLang, winScore] = order[0];
  const [, secondScore] = order[1];
  const DIFF = 0.4;

  if (winScore - secondScore >= DIFF) return winLang;

  // 6) Якщо неоднозначно, але скрипт домінує — вибираємо всередині пари
  if (cyrCount > latinCount * 1.05) {
    return score.uk >= score.ru ? "uk" : "ru";
  }
  if (latinCount > cyrCount * 1.05) {
    return score.en >= score.de ? "en" : "de";
  }

  // 7) Крайні випадки — Telegram мова або EN
  const tg = (tgLanguageCode || "").split("-")[0].toLowerCase() as Lang | "";
  return (["uk", "ru", "de", "en"] as Lang[]).includes(tg) ? tg : "en";
}