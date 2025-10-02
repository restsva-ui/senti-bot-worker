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
  /\b(and|is|are|what|why|how|with|for|content|network|server|user?s?|please|quick|hello|hi|thanks?|ok|hey)\b/i;

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

/* ===== “швидка доріжка” для коротких повідомлень ===== */

/**
 * Словники коротких/частих слів, що однозначно вказують на мову.
 * Всі слова в нижньому регістрі без пунктуації.
 */
const SHORT_LEXEMES: Record<Lang, Set<string>> = {
  uk: new Set([
    "так", "ні", "привіт", "дякую", "дяка", "гаразд", "ок", "йо", "ага",
    "прив", "вітаю"
  ]),
  ru: new Set([
    "да", "нет", "привет", "спасибо", "ок", "ага", "здорово", "здарова",
    "прив", "окей"
  ]),
  de: new Set([
    "ja", "nein", "hallo", "danke", "servus", "moin", "ok", "okay", "wie", "und"
  ]),
  en: new Set([
    "hi", "hello", "hey", "yes", "no", "ok", "okay", "yo", "yup", "nope", "hey!"
  ]),
};

/** Нормалізуємо рядок: лишаємо букви/цифри/пробіли, зводимо до нижнього регістру. */
function normalizeTiny(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // викидаємо пунктуацію/емоції
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Повертає мову, якщо коротке повідомлення складається переважно з лексем однієї мови.
 * Інакше — null (йдемо в загальну евристику).
 */
function detectShortUtteranceLang(t: string): Lang | null {
  const norm = normalizeTiny(t);
  if (!norm) return null;

  // обмежимося дуже короткими випадками (до 8 символів або ≤3 слів)
  const words = norm.split(/\s+/);
  const charLimit = 8;
  if (norm.length > charLimit && words.length > 3) return null;

  // підрахунок збігів по словниках
  const counts: Record<Lang, number> = { uk: 0, ru: 0, de: 0, en: 0 };
  for (const w of words) {
    (Object.keys(SHORT_LEXEMES) as Lang[]).forEach((lang) => {
      if (SHORT_LEXEMES[lang].has(w)) counts[lang] += 1;
    });
  }

  // якщо якась мова має явну перевагу — повертаємо її
  const ordered = (Object.keys(counts) as Lang[]).sort(
    (a, b) => counts[b] - counts[a]
  );
  const best = ordered[0];
  const second = ordered[1];

  if (counts[best] > 0 && counts[best] >= counts[second] + 1) {
    return best;
  }

  // Додаткові правила для одиничних слів кирилицею: “так/ні/да/нет”
  if (words.length === 1 && CYRILLIC.test(words[0])) {
    const w = words[0];
    if (w === "так" || w === "ні") return "uk";
    if (w === "да" || w === "нет") return "ru";
  }

  return null;
}

/**
 * Інструкція для системного промпта (дружній, розмовний стиль).
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

/* ===== основна функція визначення мови ===== */

/**
 * Визначення мови з пріоритетом на МОВУ ПОВІДОМЛЕННЯ.
 *
 * Алгоритм:
 *  1) Fast-path для коротких реплік (словниковий збіг).
 *  2) Якщо не спрацювало — скоринг за літерами/словниками/скриптом.
 *  3) Якщо явний переможець (відрив ≥ 0.5) — повертаємо його.
 *  4) Якщо неоднозначно — беремо Telegram language_code як м’який fallback.
 *  5) Фінальний fallback — "en".
 */
export function normalizeLang(input: string, tgLanguageCode?: string): Lang {
  const t = stripCommand(input);

  // 1) Спроба швидкої ідентифікації коротких реплік
  const shortGuess = detectShortUtteranceLang(t);
  if (shortGuess) return shortGuess;

  // 2) Загальна евристика
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

  // 3) якщо текст дав чітку перевагу — беремо переможця
  if (winScore - secondScore >= MARGIN) {
    return winLang;
  }

  // 4) якщо неоднозначно — дивимось на Telegram language_code
  const tg = (tgLanguageCode || "").split("-")[0].toLowerCase() as Lang | "";
  if ((["uk", "ru", "de", "en"] as Lang[]).includes(tg as Lang)) {
    return tg as Lang;
  }

  // 5) фінальний fallback
  return "en";
}