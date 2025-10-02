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

/* ===== евристики для визначення мови тексту ===== */

const RU_LETTERS = /[ёыэ]/i;       // характерні для RU
const UK_LETTERS = /[ієїґ]/i;      // характерні для UK
const DE_DIACRITICS = /[äöüß]/i;   // характерні для DE

const RU_COMMON =
  /\b(что|это|как|когда|почему|например|сеть|данн|сервер|быстр(ее|ей)|основн|котор|пользовател[ья])\b/i;

const UK_COMMON =
  /\b(що|це|як|коли|чому|наприклад|мереж|дан(их|і)|сервер|швидш|основн|який|користувач)\b/i;

/** DE: без "was" (конфліктує з англ. "was"), додані типові слова. */
const DE_COMMON =
  /\b(und|ist|nicht|ein|eine|einem|einer|warum|wie|mit|für|zum|zur|bitte|kurz|erklaere|erkläre|erklaeren|erklären|beispiel|dass|sind|gerne|möchte|moechte|vielleicht|deshalb|darum|netzwerk|server|inhalt|benutz(er|ern)?)\b/i;

const EN_COMMON =
  /\b(and|is|are|what|why|how|with|for|content|network|server|user?s?|please|quick|hello|hi|thanks?)\b/i;

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;

/** Прибираємо службовий префікс-команди з початку тексту. */
function stripCommand(raw: string): string {
  let t = (raw || "").trim();

  // прибираємо початкову команду типу /ask, /ask_openrouter, /start, /help, /ping
  t = t.replace(/^\/[a-zA-Z_]+(?:@[A-Za-z0-9_]+)?\s*/i, "");

  // деколи після команди ставлять двокрапку/тире
  t = t.replace(/^[:\-–—]\s*/, "");

  return t.trim();
}

/**
 * Інструкція для системного промпта (дружній, розмовний стиль)
 * + ЖОРСТКА заборона мета-коментарів про мови.
 *
 * Правила які усувають “Да — це так по-російськи” тощо:
 *  - відповідай ТІЛЬКИ вибраною мовою;
 *  - не перекладай і не пояснюй інші мови;
 *  - не коментуй, якою мовою було написано вхід;
 *  - навіть якщо користувач надіслав одне слово або іншу мову — відповідай повністю в обраній мові.
 */
export function languageInstruction(lang: Lang): string {
  const commonBan =
    "Важливо: не перекладай і не пояснюй інші мови; не коментуй, якою мовою був запит; " +
    "навіть якщо вхід одне слово або іншою мовою — відповідай повністю тут і зараз обраною мовою. " +
    "Не пиши преамбули типу «я ШІ/ИИ/KI». Якщо просять список — використовуй маркери. " +
    "Стиль: дружній, розмовний, прості короткі речення, без канцеляризмів.";

  switch (lang) {
    case "uk":
      return `Відповідай українською мовою. ${commonBan}`;
    case "ru":
      return `Отвечай на русском языке. ${commonBan.replace("українською", "русском")}`;
    case "de":
      return (
        "Antworte ausschließlich auf Deutsch. " +
        commonBan
          .replace("українською", "Deutsch")
          .replace("дружній, розмовний", "locker, freundlich")
      );
    case "en":
    default:
      return (
        "Answer exclusively in English. " +
        commonBan
          .replace("українською", "English")
          .replace("дружній, розмовний", "friendly, conversational")
      );
  }
}

/* ===== основна функція визначення мови ===== */

/**
 * Визначення мови з пріоритетом на МОВУ ПОВІДОМЛЕННЯ.
 *
 * Алгоритм:
 *  1) Аналізуємо текст (без команд) і рахуємо бали для uk/ru/de/en.
 *  2) Якщо є явний переможець (відрив ≥ 0.5) — повертаємо його.
 *  3) Якщо неоднозначно (різниця < 0.5 або текст дуже короткий) —
 *     тоді використовуємо Telegram language_code як м’який fallback.
 *  4) Фінальний fallback — "en".
 */
export function normalizeLang(input: string, tgLanguageCode?: string): Lang {
  const t = stripCommand(input);

  // дуже короткий текст — одразу йдемо в fallback на підставі Telegram або EN
  if (t.length < 3) {
    const tg = (tgLanguageCode || "").split("-")[0].toLowerCase() as Lang | "";
    return (["uk", "ru", "de", "en"] as Lang[]).includes(tg as Lang) ? (tg as Lang) : "en";
  }

  // підрахунок скриптів
  let latinCount = 0;
  let cyrCount = 0;
  for (const ch of t) {
    if (LATIN.test(ch)) latinCount++;
    else if (CYRILLIC.test(ch)) cyrCount++;
  }

  // базові бали зі зміщенням на ознаки тексту
  const score: Record<Lang, number> = { uk: 0, ru: 0, de: 0, en: 0 };

  // явні букви
  if (RU_LETTERS.test(t)) score.ru += 3.0;
  if (UK_LETTERS.test(t)) score.uk += 3.0;

  // діакритики DE
  if (DE_DIACRITICS.test(t)) score.de += 2.0;

  // частотні слова
  if (RU_COMMON.test(t)) score.ru += 1.8;
  if (UK_COMMON.test(t)) score.uk += 1.8;
  if (DE_COMMON.test(t)) score.de += 1.6;
  if (EN_COMMON.test(t)) score.en += 1.6;

  // домінування скрипту
  if (cyrCount > latinCount * 1.2) {
    score.uk += 1.2;
    score.ru += 1.2;
  } else if (latinCount > cyrCount * 1.2) {
    score.en += 1.0;
    score.de += 0.9;
  }

  // якщо латиниця і немає умлаутів — легкий бонус EN (менше хибних DE)
  if (latinCount > 0 && !DE_DIACRITICS.test(t)) {
    score.en += 0.4;
  }

  // визначаємо топ-2
  const order = (["uk", "ru", "de", "en"] as Lang[])
    .map((l) => [l, score[l]] as const)
    .sort((a, b) => b[1] - a[1]);

  const [winLang, winScore] = order[0];
  const [, secondScore] = order[1];

  const MARGIN = 0.5; // поріг «явної переваги» мови тексту

  // 1) якщо текст дав чітку перевагу — беремо переможця
  if (winScore - secondScore >= MARGIN) {
    return winLang;
  }

  // 2) якщо неоднозначно — дивимось на Telegram language_code
  const tg = (tgLanguageCode || "").split("-")[0].toLowerCase() as Lang | "";
  if ((["uk", "ru", "de", "en"] as Lang[]).includes(tg as Lang)) {
    return tg as Lang;
  }

  // 3) фінальний fallback
  return "en";
}