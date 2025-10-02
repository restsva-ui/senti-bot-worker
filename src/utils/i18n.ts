// src/utils/i18n.ts

/**
 * Підтримувані мови для відповідей бота.
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

/* ===== евристики ===== */

const RU_LETTERS = /[ёыэ]/i;
const UK_LETTERS = /[ієїґ]/i;
const DE_DIACRITICS = /[äöüß]/i;

const RU_COMMON =
  /\b(что|это|как|когда|почему|например|сеть|данн|сервер|быстр(ее|ей)|основн|котор|пользовател[ья])\b/i;

const UK_COMMON =
  /\b(що|це|як|коли|чому|наприклад|мереж|дан(их|і)|сервер|швидш|основн|який|користувач)\b/i;

/**
 * DE: без «was», щоб не конфліктувало з англ. «was».
 */
const DE_COMMON =
  /\b(und|ist|nicht|ein|eine|einem|einer|warum|wie|mit|für|zum|zur|bitte|kurz|erklaere|erkläre|erklaeren|erklären|beispiel|dass|sind|gerne|möchte|moechte|vielleicht|deshalb|darum|netzwerk|server|inhalt|benutz(er|ern)?)\b/i;

const EN_COMMON =
  /\b(and|is|are|what|why|how|with|for|content|network|server|user?s?|please|quick|hello|hi|thanks?)\b/i;

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;

/** Вирізаємо службові префікси / команди Telegram з початку тексту. */
function stripCommand(raw: string): string {
  let t = (raw || "").trim();

  // прибрати початкову команду типу /ask, /ask_openrouter, /start, /help, /ping
  t = t.replace(/^\/[a-zA-Z_]+(?:@[A-Za-z0-9_]+)?\s*/i, "");

  // інколи люди вставляють двокрапку після команди
  t = t.replace(/^[:\-–—]\s*/, "");

  // зайві пробіли
  t = t.trim();

  return t;
}

/**
 * Інструкція для системного промпта: дружній, розмовний тон.
 */
export function languageInstruction(lang: Lang): string {
  switch (lang) {
    case "uk":
      return "Відповідай українською у простому, дружньому стилі. Пиши так, ніби розмовляєш із другом — легко й зрозуміло, без зайвої офіційності.";
    case "ru":
      return "Отвечай по-русски простым и дружеским тоном. Пиши так, будто говоришь с приятелем — ясно и без лишней официальности.";
    case "de":
      return "Antworte auf Deutsch in einem lockeren, freundlichen Stil. Schreib so, als würdest du mit einem Freund chatten – klar, natürlich, ohne Amtsdeutsch.";
    case "en":
    default:
      return "Answer in English in a friendly, conversational tone. Keep it natural and simple, like chatting with a friend — no stiff formalities.";
  }
}

/**
 * Нормалізація/визначення мови:
 *  1) Бере Telegram language_code як базову підказку.
 *  2) Якщо в тексті є **сильні ознаки іншої мови** — перемагає текст.
 *  3) Якщо ознаки невиразні — лишається мова з Telegram.
 *  4) Fallback — en.
 *
 * Це означає: якщо у користувача інтерфейс RU, але він пише українською,
 * детектор коректно переключиться на "uk".
 */
export function normalizeLang(input: string, tgLanguageCode?: string): Lang {
  const t = stripCommand(input);

  // Підрахунок скриптів
  let latinCount = 0;
  let cyrCount = 0;
  for (const ch of t) {
    if (LATIN.test(ch)) latinCount++;
    else if (CYRILLIC.test(ch)) cyrCount++;
  }

  // Нахил від telegram language_code
  const tg = (tgLanguageCode || "").split("-")[0].toLowerCase() as
    | "uk"
    | "ru"
    | "de"
    | "en"
    | "";

  // Дуже короткий текст — віддаємо tg або en
  if (t.length < 3) {
    return (tg as Lang) || "en";
  }

  // Початкові бали за ознаками в тексті
  const score: Record<Lang, number> = { uk: 0, ru: 0, de: 0, en: 0 };

  const hasUkLetters = UK_LETTERS.test(t);
  const hasRuLetters = RU_LETTERS.test(t);
  const hasDeDia = DE_DIACRITICS.test(t);

  if (hasRuLetters) score.ru += 4;
  if (hasUkLetters) score.uk += 4;
  if (hasDeDia) score.de += 2.5;

  if (RU_COMMON.test(t)) score.ru += 2;
  if (UK_COMMON.test(t)) score.uk += 2;
  if (DE_COMMON.test(t)) score.de += 1.8;
  if (EN_COMMON.test(t)) score.en += 2.0;

  if (cyrCount > latinCount * 1.1) {
    score.uk += 1.4;
    score.ru += 1.4;
  } else if (latinCount > cyrCount * 1.1) {
    score.en += 1.2;
    score.de += 1.0;
  }

  if (latinCount > 0 && !hasDeDia) {
    score.en += 0.6; // латиниця без умляутів → легкий нахил у EN
  }

  // Кандидат за текстом
  let textWinner: Lang = "en";
  let best = -Infinity;
  (["uk", "ru", "de", "en"] as Lang[]).forEach((l) => {
    if (score[l] > best) {
      best = score[l];
      textWinner = l;
    }
  });

  // БАЗОВЕ ПРАВИЛО: Telegram мова як дефолт
  let winner: Lang = (tg as Lang) || "en";

  // СИЛЬНЕ ПРАВИЛО ПЕРЕМИКАННЯ:
  // Якщо в тексті є явні ознаки іншої мови — переключаємось, навіть якщо tg каже інше.
  // (напр., інтерфейс RU, але є українські літери/слова — беремо "uk")
  const strongSwitch =
    (winner === "ru" && (hasUkLetters || UK_COMMON.test(t))) ||
    (winner === "uk" && (hasRuLetters || RU_COMMON.test(t))) ||
    (winner === "en" && (hasDeDia || DE_COMMON.test(t))) ||
    (winner === "de" && EN_COMMON.test(t) && !hasDeDia && latinCount > cyrCount * 1.5);

  // М’ЯКЕ ПРАВИЛО ПЕРЕМИКАННЯ:
  // Якщо текстовий кандидат значно (>= 1.0 бала) перевищує мову з Telegram — теж переключимось.
  const diff = score[textWinner] - (score[winner] || 0);

  if (strongSwitch || diff >= 1.0) {
    winner = textWinner;
  }

  // Коли є кирилиця, але виграв EN — підправимо у бік uk/ru
  if (cyrCount > 0 && latinCount === 0 && winner === "en") {
    winner = score.uk >= score.ru ? "uk" : "ru";
  }
  if (cyrCount > latinCount * 0.8 && winner === "en") {
    winner = score.uk >= score.ru ? "uk" : "ru";
  }

  return winner;
}