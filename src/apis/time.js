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

function nowParts(tz) {
  const d = new Date();
  // беремо “частини” через Intl, щоб коректно для будь-якої TZ
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "long",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  return {
    year: Number(parts.year),
    monthName: parts.month,        // англ. назва місяця (en-GB)
    day: parts.day,
    time: `${parts.hour}:${parts.minute}`,
    date: new Date(d.toLocaleString("en-US", { timeZone: tz })) // “локалізований” Date
  };
}

function monthUk(m) {
  // перетворимо en-GB month → українську назву в родовому відмінку
  const map = {
    January: "січня",
    February: "лютого",
    March: "березня",
    April: "квітня",
    May: "травня",
    June: "червня",
    July: "липня",
    August: "серпня",
    September: "вересня",
    October: "жовтня",
    November: "листопада",
    December: "грудня",
  };
  return map[m] || m;
}

function monthRu(m) {
  const map = {
    January: "января",
    February: "февраля",
    March: "марта",
    April: "апреля",
    May: "мая",
    June: "июня",
    July: "июля",
    August: "августа",
    September: "сентября",
    October: "октября",
    November: "ноября",
    December: "декабря",
  };
  return map[m] || m;
}

function monthDe(m) {
  const map = {
    January: "Januar",
    February: "Februar",
    March: "März",
    April: "April",
    May: "Mai",
    June: "Juni",
    July: "Juli",
    August: "August",
    September: "September",
    October: "Oktober",
    November: "November",
    December: "Dezember",
  };
  return map[m] || m;
}

function monthFr(m) {
  const map = {
    January: "janvier",
    February: "février",
    March: "mars",
    April: "avril",
    May: "mai",
    June: "juin",
    July: "juillet",
    August: "août",
    September: "septembre",
    October: "octobre",
    November: "novembre",
    December: "décembre",
  };
  return map[m] || m;
}

function formatDateLang(parts, lang = "uk") {
  const d = parts.day;
  const y = parts.year;
  const m = parts.monthName;

  switch ((lang || "uk").slice(0, 2)) {
    case "uk":
      return `${Number(d)} ${monthUk(m)} ${y} року`;
    case "ru":
      return `${Number(d)} ${monthRu(m)} ${y} года`;
    case "de":
      return `${Number(d)}. ${monthDe(m)} ${y}`;
    case "fr":
      return `${Number(d)} ${monthFr(m)} ${y}`;
    default:
      // en
      return `${m} ${Number(d)}, ${y}`;
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

  // будь-яка комбінація “сьогодні” + “дата/день”
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

export function timeIntent(text = "") {
  const s = String(text).trim().toLowerCase();
  if (!s) return false;

  // широка логіка: ключові слова про час
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

export function replyCurrentTime(env, lang = "uk") {
  const tz = resolveTz(env);
  const parts = nowParts(tz);
  const clockEmoji = "🕒";
  const nowWord = phraseNow(lang);
  // додамо позначку TZ в дужках, щоб було зрозуміло
  return `${clockEmoji} ${nowWord} ${parts.time} (${tz}).`;
}