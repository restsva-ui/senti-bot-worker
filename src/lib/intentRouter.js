// src/lib/intentRouter.js
// Визначення наміру з природної мови + виклик відповідного API

import { weatherByCity, formatWeather } from "./apis/weather.js";
import { getUsdUahRate, formatRate } from "./apis/rates.js";
import { fetchTopNews, formatNewsList } from "./apis/news.js";
import { getHolidays, formatHolidays } from "./apis/holidays.js";
import { wikiSummary, formatSummary } from "./apis/wiki.js";

// ───────── detectIntent ─────────
// Повертає { type, ...payload } або { type: "none" }
export function detectIntent(text = "", lang = "uk") {
  const s = String(text || "").toLowerCase().trim();

  // швидкі нормалізації
  const clear = s
    .replace(/[.,!?()'"`«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const has = (re) => re.test(clear);

  // 1) КУРС ВАЛЮТИ: USD → UAH (укр-формулювання)
  // приклади: "курс долара", "який курс usd", "usd uah", "скільки гривень за долар"
  if (
    has(/\bкурс\b.*\b(usd|долар|долара|доларів|бакс)\b/) ||
    has(/\b(usd|\$)\s*(to|→|в|у)\s*(uah|грн|гривн[яії])\b/) ||
    has(/\bскільки\s+(гривень|грн)\s+за\s+(долар|usd|\$)\b/)
  ) {
    return { type: "rates", from: "USD", to: "UAH", lang };
  }

  // 2) ПОГОДА: "погода в києві / львів", "температура у харкові"
  // базово: шукаємо слово "погода" і місто після "в/у"
  if (has(/\bпогода\b/)) {
    // дуже простий граббер міста після "в|у"
    const m = clear.match(/\b(?:в|у)\s+([a-zа-яіїєґ\- ]{2,})$/i);
    const city = m ? capitalizeCity(m[1]) : "Kyiv";
    return { type: "weather", city: city, lang };
  }

  // 3) НОВИНИ: "головні новини", "новини україни за сьогодні", "топ новини"
  if (
    has(/\b(новини|топ новини|головні новини|новини дня)\b/) ||
    has(/\bновини\b.*\b(сьогодні|за сьогодні)\b/)
  ) {
    return { type: "news", country: "ua", lang };
  }

  // 4) СВЯТА: "державні свята 2025", "офіційні свята в україні"
  const mYear = clear.match(/\b(20\d{2})\b/);
  if (
    has(/\b(державні|офіційні)\s+свята\b/) ||
    has(/\bсвята\b.*\bв\s+україн[іи]\b/)
  ) {
    return { type: "holidays", country: "UA", year: mYear ? +mYear[1] : 2025, lang };
  }

  // 5) ВІКІ: "хто такий шевченко", "що таке блокчейн"
  const who = clear.match(/\bхто\s+такий\s+(.+?)$/i);
  if (who && who[1]) {
    return { type: "wiki", title: who[1].trim(), lang };
  }
  const what = clear.match(/\bщо\s+таке\s+(.+?)$/i);
  if (what && what[1]) {
    return { type: "wiki", title: what[1].trim(), lang };
  }

  return { type: "none" };
}

function capitalizeCity(x = "") {
  return x
    .split(" ")
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : ""))
    .join(" ")
    .trim();
}

// ───────── runIntent ─────────
export async function runIntent(intent) {
  switch (intent.type) {
    case "weather": {
      const city = intent.city || "Kyiv";
      const data = await weatherByCity(city, intent.lang);
      return formatWeather(data);
    }
    case "rates": {
      // Поки що підтримуємо головний кейс USD → UAH
      if (intent.from === "USD" && (!intent.to || intent.to === "UAH")) {
        const rate = await getUsdUahRate();
        return formatRate(rate);
      }
      // Фолбек: все одно покажемо USD→UAH
      const rate = await getUsdUahRate();
      return formatRate(rate);
    }
    case "news": {
      // Україна за замовчуванням
      const items = await fetchTopNews(intent.country || "ua", "general");
      // Markdown-список
      return formatNewsList(items).slice(0, 1500);
    }
    case "holidays": {
      const items = await getHolidays(intent.country || "UA", intent.year || 2025);
      return formatHolidays(items);
    }
    case "wiki": {
      const s = await wikiSummary(intent.title, intent.lang || "uk");
      return formatSummary(s);
    }
    default:
      return null;
  }
}