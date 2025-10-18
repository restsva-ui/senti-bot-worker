// src/apis/time.js

// Нормалізуємо таймзону: спершу ENV, потім з тексту, далі UTC.
export function pickTimezone(env, hintText = "") {
  const fromEnv = (env.TIMEZONE || env.TZ || "").trim();
  if (fromEnv) return fromEnv;

  // Невеличкий евристичний парсер таймзони з тексту (опціонально)
  const m = String(hintText).match(/\b(UTC[+-]\d{1,2}|Europe\/Kyiv|Europe\/Kiev|Europe\/Berlin|Europe\/Paris|America\/\w+|Asia\/\w+)\b/i);
  if (m) return m[1];

  return "UTC";
}

// Поточний час у вибраній TZ. CF Workers підтримують Intl з IANA TZ.
export function nowInTZ(tz) {
  const fmt = new Intl.DateTimeFormat("uk-UA", {
    timeZone: tz,
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const parts = fmt.formatToParts(new Date());
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  const text = `${obj.day} ${obj.month} ${obj.year} року`;
  return { text, tz };
}

// Простий інтенt “дата/час?” (у нас поки лише дата)
export function dateIntent(text = "") {
  const s = String(text).toLowerCase();
  // ключові фрази різними мовами
  const rx = /\b(яка\s+сьогодні\s+дата|today'?s?\s+date|какая\s+сегодня\s+дата|heute\s+datum|quelle\s+date\s+aujourd'hui)\b/i;
  return rx.test(s);
}