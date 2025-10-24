// src/apis/time.js

// ---------- утиліти часу/дати ----------
const DEFAULT_TZ = "Europe/Kyiv";

export function resolveTz(env, fallback = DEFAULT_TZ) {
  const tz =
    env?.TIMEZONE ||
    env?.DEFAULT_TIMEZONE ||
    fallback;
  return tz || DEFAULT_TZ;
}

/**
 * Повертає Date, «локалізований» до конкретної TZ.
 * Це не просто форматування — ми реально будуємо об’єкт Date зі зміщеним часом.
 */
function toZonedDate(baseUtcDate, tz) {
  // перетворимо UTC-дату на рядок у потрібній TZ, а потім назад у Date
  return new Date(baseUtcDate.toLocaleString("en-US", { timeZone: tz }));
}

/**
 * Зсунути локалізовану дату на N днів (N може бути від’ємним).
 * Використовуємо 86_400_000 мс. Так, під час переходу на/з DST можливе ±1 год у time,
 * але для «дати» це не критично — ми все одно дістаємо лише рік/місяць/день.
 */
function shiftDays(zonedDate, offsetDays = 0) {
  const MS_PER_DAY = 86_400_000;
  return new Date(zonedDate.getTime() + offsetDays * MS_PER_DAY);
}

/**
 * Розкладає дату на частини (рік, місяць ENG, день, HH:mm) у даній TZ
 */
function partsOf(dateObj, tz) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(dateObj).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    monthName: parts.month,        // англ. назва місяця (en-GB)
    day: parts.day,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * Актуальні частини для «зараз» у TZ
 */
function nowParts(tz) {
  const dUtc = new Date();
  const zoned = toZonedDate(dUtc, tz);
  return { ...partsOf(zoned, tz), date: zoned };
}

// ---------- локалізація місяців ----------
function monthUk(m) {
  const map = {
    January: "січня", February: "лютого",   March: "березня",
    April:   "квітня", May:      "травня",  June:  "червня",
    July:    "липня",  August:   "серпня",  September: "вересня",
    October: "жовтня", November: "листопада", December: "грудня",
  };
  return map[m] || m;
}
function monthRu(m) {
  const map = {
    January: "января", February: "февраля", March: "марта",
    April:   "апреля", May:      "мая",     June:  "июня",
    July:    "июля",   August:   "августа", September: "сентября",
    October: "октября", November: "ноября", December: "декабря",
  };
  return map[m] || m;
}
function monthDe(m) {
  const map = {
    January: "Januar", February: "Februar", March: "März",
    April:   "April",  May:      "Mai",     June:  "Juni",
    July:    "Juli",   August:   "August",  September: "September",
    October: "Oktober", November: "November", December: "Dezember",
  };
  return map[m] || m;
}
function monthFr(m) {
  const map = {
    January: "janvier", February: "février", March: "mars",
    April:   "avril",   May:      "mai",     June:  "juin",
    July:    "juillet", August:   "août",    September: "septembre",
    October: "octobre", November: "novembre", December: "décembre",
  };
  return map[m] || m;
}

function formatDateLang(parts, lang = "uk") {
  const d = parts.day;
  const y = parts.year;
  const m = parts.monthName;

  switch ((lang || "uk").slice(0, 2)) {
    case "uk": return `${Number(d)} ${monthUk(m)} ${y} року`;
    case "ru": return `${Number(d)} ${monthRu(m)} ${y} года`;
    case "de": return `${Number(d)}. ${monthDe(m)} ${y}`;
    case "fr": return `${Number(d)} ${monthFr(m)} ${y}`;
    default:   return `${m} ${Number(d)}, ${y}`; // en
  }
}

function phraseToday(lang = "uk") {
  switch ((lang || "uk").slice(0, 2)) {
    case "uk": return "Сьогодні";
    case "ru": return "Сегодня";
    case "de": return "Heute";
    case "fr": return "Aujourd’hui";
    default:   return "Today";
  }
}
function phraseTomorrow(lang = "uk") {
  switch ((lang || "uk").slice(0, 2)) {
    case "uk": return "Завтра";
    case "ru": return "Завтра";
    case "de": return "Morgen";
    case "fr": return "Demain";
    default:   return "Tomorrow";
  }
}
function phraseYesterday(lang = "uk") {
  switch ((lang || "uk").slice(0, 2)) {
    case "uk": return "Вчора";
    case "ru": return "Вчера";
    case "de": return "Gestern";
    case "fr": return "Hier";
    default:   return "Yesterday";
  }
}
function phraseNow(lang = "uk") {
  switch ((lang || "uk").slice(0, 2)) {
    case "uk": return "Зараз";
    case "ru": return "Сейчас";
    case "de": return "Jetzt";
    case "fr": return "Maintenant";
    default:   return "Now";
  }
}

// ---------- інтенти ----------
export function dateIntent(text = "") {
  const s = String(text).trim().toLowerCase();
  if (!s) return false;

  if (s.includes("сьогодні") && (s.includes("дата") || s.includes("день"))) return true;

  const phrases = [
    // uk
    "яка сьогодні дата", "сьогоднішня дата", "який сьогодні день",
    // ru
    "какая сегодня дата", "какой сегодня день",
    // en
    "what is the date", "what is the date today", "what's the date", "date today",
    // de
    "welches datum", "welches datum ist heute",
    // fr
    "quelle est la date", "quelle date sommes-nous"
  ];
  return phrases.some(p => s.includes(p));
}

export function tomorrowDateIntent(text = "") {
  const s = String(text).trim().toLowerCase();
  if (!s) return false;

  const phrases = [
    // uk
    "яка завтра дата", "дата завтра", "завтрашня дата",
    // ru
    "какая завтра дата", "дата завтра",
    // en
    "what is the date tomorrow", "tomorrow date", "what's the date tomorrow",
    // de
    "welches datum ist morgen", "datum morgen",
    // fr
    "quelle est la date demain", "date demain"
  ];
  return phrases.some(p => s.includes(p));
}

export function yesterdayDateIntent(text = "") {
  const s = String(text).trim().toLowerCase();
  if (!s) return false;

  const phrases = [
    // uk
    "яка вчора була дата", "яка була вчора дата", "вчорашня дата",
    // ru
    "какая вчера была дата", "вчерашняя дата",
    // en
    "what was the date yesterday", "yesterday date",
    // de
    "welches datum war gestern", "datum gestern",
    // fr
    "quelle était la date hier", "date hier"
  ];
  return phrases.some(p => s.includes(p));
}

export function timeIntent(text = "") {
  const s = String(text).trim().toLowerCase();
  if (!s) return false;

  const hasCore =
    s.includes("котра година") ||
    s.includes("скільки час") ||
    s.includes("котрий час") ||
    s.includes("который час") ||
    s.includes("сколько времени") ||
    s.includes("time is it") ||
    s.includes("what time") ||
    s.includes("time now") ||
    s === "час" || s === "время";

  return hasCore;
}

// ---------- відповіді ----------
export function replyCurrentDate(env, lang = "uk") {
  const tz = resolveTz(env);
  const parts = nowParts(tz);
  const dateText = formatDateLang(parts, lang);
  const prefix = phraseToday(lang);
  const calEmoji = "🗓️";
  return `${calEmoji} ${prefix} ${dateText}.`;
}

export function replyTomorrowDate(env, lang = "uk") {
  const tz = resolveTz(env);
  const zonedNow = toZonedDate(new Date(), tz);
  const target = shiftDays(zonedNow, 1);
  const p = partsOf(target, tz);
  const calEmoji = "🗓️";
  return `${calEmoji} ${phraseTomorrow(lang)}, ${formatDateLang(p, lang)}.`;
}

export function replyYesterdayDate(env, lang = "uk") {
  const tz = resolveTz(env);
  const zonedNow = toZonedDate(new Date(), tz);
  const target = shiftDays(zonedNow, -1);
  const p = partsOf(target, tz);
  const calEmoji = "🗓️";
  return `${calEmoji} ${phraseYesterday(lang)}, ${formatDateLang(p, lang)}.`;
}

export function replyCurrentTime(env, lang = "uk") {
  const tz = resolveTz(env);
  const parts = nowParts(tz);
  const clockEmoji = "🕒";
  const nowWord = phraseNow(lang);
  return `${clockEmoji} ${nowWord} ${parts.time} (${tz}).`;
}