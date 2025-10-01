// src/utils/i18n.ts

/**
 * Підтримувані мови для відповідей бота.
 */
export type Lang = "uk" | "ru" | "de" | "en";

/**
 * Людська назва мови (для логів/діагностики за бажанням).
 */
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

/**
 * Невеликий набір частих слів/символів для евристичного скорингу.
 * Не прагнемо до ідеальної класифікації — лише покращуємо базову,
 * щоб уникнути ситуації, коли будь-яка кирилиця = RU.
 */
const RU_LETTERS = /[ёыэ]/i; // російські специфічні
const UK_LETTERS = /[ієїґ]/i; // українські специфічні
const DE_DIACRITICS = /[äöüß]/i;

const RU_COMMON = /\b(что|это|как|когда|почему|просто|например|сеть|данн|сервер|быстрее|основн|котор|пользовател)/i;
const UK_COMMON = /\b(що|це|як|коли|чому|наприклад|мереж|даних|сервер|швидш|основн|який|користувач)/i;
const DE_COMMON = /\b(und|ist|nicht|ein|eine|einem|einer|was|warum|zum|mit|für|Netzwerk|Server|Inhalt)/i;
const EN_COMMON = /\b(and|is|are|what|why|with|for|content|network|server|users?)\b/i;

/**
 * Підрахунок символів зі скриптів.
 */
const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * Повертає підказку для системного/інструкційного промпта,
 * яка змушує модель відповідати обраною мовою.
 */
export function languageInstruction(lang: Lang): string {
  switch (lang) {
    case "uk":
      return "Відповідай українською мовою. Якщо питання іншою мовою — все одно відповідай українською.";
    case "ru":
      return "Отвечай на русском языке. Если вопрос на другом языке — всё равно отвечай по-русски.";
    case "de":
      return "Antworte auf Deutsch. Auch wenn die Frage in einer anderen Sprache ist, antworte bitte auf Deutsch.";
    case "en":
    default:
      return "Answer in English. Even if the question is in another language, reply in English.";
  }
}

/**
 * Нормалізація/визначення мови:
 *  - спершу враховуємо Telegram `language_code` (як слабку підказку),
 *  - далі — скоринг тексту за ознаками,
 *  - у випадку рівності/невизначеності — EN як нейтральний fallback.
 *
 * Важливо: ця функція не робить зовнішніх запитів і не ламає існуючу логіку.
 */
export function normalizeLang(text: string, tgLanguageCode?: string): Lang {
  const t = (text || "").trim();

  // 1) Telegram language_code як "легкий нахил" (але не жорстка прив'язка)
  const tg = (tgLanguageCode || "").split("-")[0].toLowerCase();
  let tgBias: Partial<Record<Lang, number>> = {};
  if (tg === "uk") tgBias.uk = 0.75;
  else if (tg === "ru") tgBias.ru = 0.75;
  else if (tg === "de") tgBias.de = 0.75;
  else if (tg === "en") tgBias.en = 0.75;

  // 2) Порожній або дуже короткий текст — схиляємось до мови інтерфейсу або EN
  if (t.length < 3) {
    const guess = (Object.keys(tgBias)[0] as Lang | undefined) || "en";
    return guess;
  }

  // 3) Базові підрахунки сценаріїв письма
  let latinCount = 0;
  let cyrCount = 0;
  for (const ch of t) {
    if (LATIN.test(ch)) latinCount++;
    else if (CYRILLIC.test(ch)) cyrCount++;
  }

  // 4) Початкові бали
  const score: Record<Lang, number> = { uk: 0, ru: 0, de: 0, en: 0 };

  // 5) Рос/Укр явні букви
  if (RU_LETTERS.test(t)) score.ru += 3;
  if (UK_LETTERS.test(t)) score.uk += 3;

  // 6) Діакритика німецької
  if (DE_DIACRITICS.test(t)) score.de += 2;

  // 7) Часті слова
  if (RU_COMMON.test(t)) score.ru += 1.5;
  if (UK_COMMON.test(t)) score.uk += 1.5;
  if (DE_COMMON.test(t)) score.de += 1.5;
  if (EN_COMMON.test(t)) score.en += 1.0;

  // 8) За домінуванням скрипту
  if (cyrCount > latinCount * 1.2) {
    // кирилиця домінує — змагаються UA vs RU
    score.uk += 1.2;
    score.ru += 1.2;
  } else if (latinCount > cyrCount * 1.2) {
    // латиниця домінує — змагаються EN vs DE
    score.en += 1.0;
    score.de += 1.0;
  }

  // 9) Нахил від телеграм-коду (якщо був)
  if (tgBias.uk) score.uk += tgBias.uk;
  if (tgBias.ru) score.ru += tgBias.ru;
  if (tgBias.de) score.de += tgBias.de;
  if (tgBias.en) score.en += tgBias.en;

  // 10) Вирішуємо переможця
  let winner: Lang = "en";
  let best = -Infinity;
  (["uk", "ru", "de", "en"] as Lang[]).forEach((l) => {
    if (score[l] > best) {
      best = score[l];
      winner = l;
    }
  });

  // Дрібна правка: якщо латиниця значно домінує, але виграла RU/UK — перевага DE/EN.
  if (latinCount > cyrCount * 2) {
    if (winner === "ru" || winner === "uk") {
      winner = score.de >= score.en ? "de" : "en";
    }
  }

  return winner;
}