// src/apis/time.js

// Невелика мапа міст -> IANA таймзона (можеш розширювати за потребою)
const CITY_TZ = {
  // Україна
  "київ": "Europe/Kyiv",
  "kyiv": "Europe/Kyiv",
  "kiev": "Europe/Kyiv",
  "львів": "Europe/Kyiv",
  "lviv": "Europe/Kyiv",
  "харків": "Europe/Kyiv",
  "kharkiv": "Europe/Kyiv",

  // Європа
  "warsaw": "Europe/Warsaw",
  "berlin": "Europe/Berlin",
  "paris": "Europe/Paris",
  "madrid": "Europe/Madrid",
  "rome": "Europe/Rome",
  "london": "Europe/London",

  // США
  "new york": "America/New_York",
  "los angeles": "America/Los_Angeles",
  "san francisco": "America/Los_Angeles",
  "chicago": "America/Chicago",

  // Інше
  "istanbul": "Europe/Istanbul",
  "dubai": "Asia/Dubai",
  "tokyo": "Asia/Tokyo",
};

/**
 * Дуже простий детектор наміру "яка сьогодні дата?"
 * Працює для укр/рос/англ/фр/нім. За потреби додай фрази.
 */
export function dateIntent(text = "") {
  const s = String(text).trim().toLowerCase();
  if (!s) return false;
  const phrases = [
    // uk
    "яка сьогодні дата", "яка сьогодні дата?", "яка сьогодні дата?",
    "сьогоднішня дата", "який сьогодні день", "який сьогодні день?",

    // ru
    "какая сегодня дата", "какая сегодня дата?", "какой сегодня день", "какой сегодня день?",

    // en
    "what is the date", "what is the date today", "what's the date", "date today",

    // de
    "welches datum", "welches datum ist heute",

    // fr
    "quelle est la date", "c'est quelle date", "quelle date sommes-nous",
  ];
  return phrases.some(p => s.includes(p));
}

/**
 * Детектор наміру "котра година?"
 */
export function timeIntent(text = "") {
  const s = String(text).trim().toLowerCase();
  if (!s) return false;
  const phrases = [
    // uk
    "котра година", "який зараз час", "скільки зараз часу",

    // ru
    "который час", "сколько времени", "сколько сейчас времени",

    // en
    "what time is it", "current time", "time now",

    // de
    "wie spät ist es",

    // fr
    "quelle heure est-il",
  ];
  return phrases.some(p => s.includes(p));
}

/**
 * Спроба витягнути місто з тексту та повернути IANA таймзону.
 * Якщо місто не знайдено — беремо env.TIMEZONE, інакше UTC.
 */
export function pickTimezone(env = {}, text = "") {
  const fallback = env.TIMEZONE || "UTC";
  const s = String(text || "").toLowerCase();

  // Шукаємо точні збіги ключових міст (без regex-екзотики)
  for (const key of Object.keys(CITY_TZ)) {
    if (s.includes(key)) return CITY_TZ[key];
  }
  return fallback;
}

/**
 * Повертає поточну дату/час у вибраній таймзоні.
 * result.text — “10 червня 2024 року, 18:45”
 * result.dateText — тільки дата
 * result.timeText — тільки час
 * result.timezone — назва таймзони
 * result.iso — ISO рядок у цій TZ (для логів)
 */
export function nowInTZ(timezone = "UTC") {
  const now = new Date();

  const dateText = new Intl.DateTimeFormat("uk-UA", {
    timeZone: timezone,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  const timeText = new Intl.DateTimeFormat("uk-UA", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  // загальний рядок
  const text = `${dateText}`;

  // ISO приблизно в TZ (для логів/діагностики)
  // Примітка: у JS Date немає "локального ISO для TZ", тож залишимо стандартний ISO.
  const iso = now.toISOString();

  return { text, dateText, timeText, timezone, iso, date: now };
}