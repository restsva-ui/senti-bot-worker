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
 * DE: прибрали "was" (надто конфліктує з англ. "was"),
 * додали деякі характерні слова/форми з умлаутами/ß.
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
 * Повертає інструкцію для системного промпта під вибрану мову.
 * Тут налаштовано дружній стиль без канцеляризмів.
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
 *  1) ігноруємо префікс-команду (/ask, /ask_openrouter, ...),
 *  2) враховуємо Telegram language_code як м’який (інколи — сильний) нахил,
 *  3) скоримо текст за літерами/частими словами,
 *  4) tie-break на користь EN, якщо tg=en і бали близькі,
 *  5) fallback — en.
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

  if (tg === "en" && cyrCount === 0) {
    return "en";
  }

  let tgBias: Partial<Record<Lang, number>> = {};
  if (tg === "uk") tgBias.uk = 0.9;
  else if (tg === "ru") tgBias.ru = 0.9;
  else if (tg === "de") tgBias.de = 0.9;
  else if (tg === "en") tgBias.en = 0.9;

  if (t.length < 3) {
    const guess = (Object.keys(tgBias)[0] as Lang | undefined) || "en";
    return guess;
  }

  const score: Record<Lang, number> = { uk: 0, ru: 0, de: 0, en: 0 };

  if (RU_LETTERS.test(t)) score.ru += 4;
  if (UK_LETTERS.test(t)) score.uk += 4;
  if (DE_DIACRITICS.test(t)) score.de += 2.5;

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

  if (latinCount > 0 && !DE_DIACRITICS.test(t)) {
    score.en += 0.6;
  }

  if (tgBias.uk) score.uk += tgBias.uk;
  if (tgBias.ru) score.ru += tgBias.ru;
  if (tgBias.de) score.de += tgBias.de;
  if (tgBias.en) score.en += tgBias.en;

  let winner: Lang = "en";
  let best = -Infinity;
  (["uk", "ru", "de", "en"] as Lang[]).forEach((l) => {
    if (score[l] > best) {
      best = score[l];
      winner = l;
    }
  });

  if (cyrCount > 0 && latinCount === 0 && winner === "en") {
    winner = score.uk >= score.ru ? "uk" : "ru";
  }
  if (cyrCount > latinCount * 0.8 && winner === "en") {
    winner = score.uk >= score.ru ? "uk" : "ru";
  }

  if (tg === "en") {
    const sorted = (["uk", "ru", "de", "en"] as Lang[])
      .map((l) => [l, score[l]] as const)
      .sort((a, b) => b[1] - a[1]);
    const [topL, topS] = sorted[0];
    const [, secondS] = sorted[1];
    if (topL !== "en" && topS - secondS < 0.3) {
      winner = "en";
    }
  }

  return winner;
}