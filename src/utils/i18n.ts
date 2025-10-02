// src/utils/i18n.ts

/** Підтримувані мови для відповідей бота. */
export type Lang = "uk" | "ru" | "de" | "en";

/** Людська назва мови (для логів/діагностики). */
export function langName(lang: Lang): string {
  switch (lang) {
    case "uk": return "Українська";
    case "ru": return "Русский";
    case "de": return "Deutsch";
    case "en":
    default:   return "English";
  }
}

/* ===== евристики для визначення мови тексту ===== */

const RU_LETTERS = /[ёыэ]/i;      // характерні для RU
const UK_LETTERS = /[ієїґ]/i;     // характерні для UK
const DE_DIACRITICS = /[äöüß]/i;  // характерні для DE

const RU_COMMON =
  /\b(да|нет|ок(?:ей)?|что|это|как|когда|почему|например|сеть|данн|сервер|быстр(ее|ей)|основн|котор|пользовател[ья])\b/i;

const UK_COMMON =
  /\b(так|ні|ок(?:ей)?|що|це|як|коли|чому|наприклад|мереж|дан(их|і)|сервер|швидш|основн|який|користувач)\b/i;

const DE_COMMON =
  /\b(ja|nein|und|ist|nicht|ein|eine|einem|einer|warum|wie|mit|für|zum|zur|bitte|kurz|erklaere|erkläre|erklaeren|erklären|beispiel|dass|sind|gerne|möchte|moechte|vielleicht|deshalb|darum|netzwerk|server|inhalt|benutz(er|ern)?)\b/i;

const EN_COMMON =
  /\b(ok(?:ay)?|yes|no|hi|hey|and|is|are|what|why|how|with|for|content|network|server|user?s?|please|quick|hello|thanks?)\b/i;

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;

/** Прибираємо службовий префікс-команди з початку тексту. */
function stripCommand(raw: string): string {
  let t = (raw || "").trim();
  // /ask, /start, /help, /ask@MyBot …
  t = t.replace(/^\/[a-zA-Z_]+(?:@[A-Za-z0-9_]+)?\s*/i, "");
  // двокрапка/тире після команди
  t = t.replace(/^[:\-–—]\s*/, "");
  return t.trim();
}

/** Нормалізує слово: нижній регістр + прибирає просту пунктуацію з країв. */
function normWord(s: string): string {
  return s
    .toLowerCase()
    .replace(/^[\s.,!?()[\]{}"'«»„“”‘’`~]+|[\s.,!?()[\]{}"'«»„“”‘’`~]+$/g, "");
}

/** Manual overrides для коротких слів/привітань (однозначна мова). */
const MANUAL_OVERRIDES: Record<string, Lang> = {
  // Ukrainian
  "так": "uk", "ні": "uk", "привіт": "uk",
  // Russian
  "да": "ru", "нет": "ru", "привет": "ru",
  // English (латиниця)
  "hi": "en", "hello": "en", "yes": "en", "no": "en", "ok": "en", "okay": "en",
  // German
  "ja": "de", "nein": "de", "hallo": "de",
};

/**
 * Системна інструкція: одна мова, лаконічно, без метакоментарів.
 */
export function composeSystemInstruction(lang: Lang): string {
  switch (lang) {
    case "uk":
      return [
        "Відповідай виключно українською.",
        "Коротко і дружньо: для привітань/«так/ні» — 1 рядок; для пояснень — 1–2 короткі речення.",
        "Не перекладай і не коментуй мову запиту. Якщо потрібен список — маркери (до 5).",
        "Якщо бракує контексту — задай рівно 1 уточнювальне запитання. Без вигадок.",
      ].join(" ");
    case "ru":
      return [
        "Отвечай исключительно на русском.",
        "Кратко и дружелюбно: приветствие/«да-нет» — 1 строка; объяснения — 1–2 коротких предложения.",
        "Не переводить и не комментировать язык запроса. Списки — маркерами (до 5).",
        "Если контекста мало — ровно 1 уточняющий вопрос. Без выдумок.",
      ].join(" ");
    case "de":
      return [
        "Antworte ausschließlich auf Deutsch.",
        "Kurz und freundlich: Gruß/Ja–Nein – 1 Zeile; Erklärungen – 1–2 kurze Sätze.",
        "Keine Übersetzung, keine Kommentare zur Sprache. Listen als Aufzählungen (max. 5).",
        "Fehlt Kontext, stelle genau eine Rückfrage. Nichts erfinden.",
      ].join(" ");
    case "en":
    default:
      return [
        "Answer exclusively in English.",
        "Keep it short and friendly: greetings/yes–no — one line; explanations — 1–2 short sentences.",
        "Do not translate or mention the input language. Use bullet points (up to 5) for lists.",
        "If context is missing, ask exactly one clarifying question. No fabrication.",
      ].join(" ");
  }
}

/* ===== основна функція визначення мови ===== */
export function normalizeLang(input: string, tgLanguageCode?: string): Lang {
  const stripped = stripCommand(input);
  const tLower = stripped.toLowerCase();

  // --- 0) Manual override для однословних і дуже коротких запитів
  const words = tLower.split(/\s+/).filter(Boolean).map(normWord).filter(Boolean);

  if (words.length === 1) {
    const w = words[0];

    // якщо слово чітко відоме — повертаємо мову негайно
    if (MANUAL_OVERRIDES[w]) return MANUAL_OVERRIDES[w];

    // короткі слова (<=5): спочатку дивимось на алфавіт
    if (w.length <= 5) {
      const hasLatin = /[a-z]/i.test(w);
      const hasCyr = /[а-яёіїєґ]/i.test(w);

      if (hasCyr && !hasLatin) {
        if (UK_LETTERS.test(w)) return "uk";
        if (RU_LETTERS.test(w)) return "ru";
      }
      if (hasLatin && !hasCyr) {
        if (DE_DIACRITICS.test(w)) return "de";
        if (w === "hallo") return "de";
        return "en";
      }
    }
  }

  // --- 1) Дуже короткий текст загалом — fallback від Telegram або EN
  if (stripped.length < 3) {
    const tg = (tgLanguageCode || "").split("-")[0].toLowerCase() as Lang | "";
    return (["uk", "ru", "de", "en"] as Lang[]).includes(tg) ? (tg as Lang) : "en";
  }

  // --- 2) Підрахунок скриптів
  let latinCount = 0;
  let cyrCount = 0;
  for (const ch of stripped) {
    if (LATIN.test(ch)) latinCount++;
    else if (CYRILLIC.test(ch)) cyrCount++;
  }

  // --- 3) Набираємо бали за ознаками
  const score: Record<Lang, number> = { uk: 0, ru: 0, de: 0, en: 0 };

  if (RU_LETTERS.test(stripped)) score.ru += 3.0;
  if (UK_LETTERS.test(stripped)) score.uk += 3.0;
  if (DE_DIACRITICS.test(stripped)) score.de += 2.0;

  if (RU_COMMON.test(stripped)) score.ru += 1.8;
  if (UK_COMMON.test(stripped)) score.uk += 1.8;
  if (DE_COMMON.test(stripped)) score.de += 1.6;
  if (EN_COMMON.test(stripped)) score.en += 1.6;

  if (cyrCount > latinCount * 1.2) {
    score.uk += 1.2;
    score.ru += 1.2;
  } else if (latinCount > cyrCount * 1.2) {
    score.en += 1.0;
    score.de += 0.9;
  }

  if (latinCount > 0 && !DE_DIACRITICS.test(stripped)) {
    score.en += 0.4;
  }

  // --- 4) Переможець за балами
  const order = (["uk", "ru", "de", "en"] as Lang[])
    .map((l) => [l, score[l]] as const)
    .sort((a, b) => b[1] - a[1]);

  const [winLang, winScore] = order[0];
  const [, secondScore] = order[1];

  // поріг «явної переваги» — краще ловить короткі репліки
  const MARGIN = 0.35;

  if (winScore - secondScore >= MARGIN) return winLang;

  // --- 5) Неоднозначно — дивимось на Telegram language_code
  const tg = (tgLanguageCode || "").split("-")[0].toLowerCase() as Lang | "";
  if ((["uk", "ru", "de", "en"] as Lang[]).includes(tg)) {
    return tg as Lang;
  }

  // --- 6) Фінальний fallback
  return "en";
}

/** Аліас для сумісності зі старим ім'ям */
export { composeSystemInstruction as languageInstruction };