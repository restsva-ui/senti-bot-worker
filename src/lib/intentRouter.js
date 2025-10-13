// src/lib/intentRouter.js
// Визначення наміру з тексту + виклик відповідного API

import { weatherByCity, formatWeather } from "./apis/weather.js";
import { getUsdUahRate, formatRate } from "./apis/rates.js";
import { fetchTopNews, formatNewsList } from "./apis/news.js";
import { getHolidays, formatHolidays } from "./apis/holidays.js";
import { wikiSummary, formatSummary } from "./apis/wiki.js";

// ───────── intents: detect ─────────
export function detectIntent(text, lang = "uk") {
  const t = String(text || "").trim();
  const low = t.toLowerCase();

  // WEATHER
  // укр/рус/англ короткі патерни + "погода в Києві"/"weather in Berlin"
  if (/(погода|погоди|погоду|weather)\s*(в|у|in)?\s*/i.test(t)) {
    const m = low.match(/(?:в|у|in)\s+([a-zа-яіїєґ\-\s]+)/i);
    const city = m ? m[1].trim().replace(/[.,!?]+$/, "") : null;
    return { type: "weather", city: city || null, lang };
  }

  // RATES: USD→UAH
  if (
    /(курс|rate).*(долара|usd|долар|dollar)/i.test(t) ||
    /(usd).*(uah)/i.test(low)
  ) {
    return { type: "rates", from: "USD", to: "UAH", lang };
  }

  // NEWS
  if (/(новини|новостей|news)/i.test(t)) {
    return { type: "news", country: "ua", lang };
  }

  // HOLIDAYS
  if (/(свята|праздники|holidays)/i.test(t)) {
    const y = (low.match(/20\d{2}/) || [])[0];
    const year = y ? Number(y) : undefined;
    return { type: "holidays", country: "UA", year, lang };
  }

  // WIKI (хто такий/what is …)
  const mw = low.match(/^(хто такий|хто така|кто такой|кто такая|who is|what is)\s+(.+)$/i);
  if (mw) {
    return { type: "wiki", title: mw[2].trim(), lang };
  }

  return null;
}

// ───────── intents: run ─────────
export async function runIntent(intent) {
  switch (intent.type) {
    case "weather": {
      const city = intent.city || "Kyiv";
      const data = await weatherByCity(city, intent.lang);
      return formatWeather(data);
    }
    case "rates": {
      // Поки що підтримуємо USD→UAH (як і в твоєму rates.js)
      const x = await getUsdUahRate();
      return formatRate(x);
    }
    case "news": {
      const items = await fetchTopNews(intent.country, "general");
      return formatNewsList(items).slice(0, 1500); // TG safe size
    }
    case "holidays": {
      const items = await getHolidays(intent.country, intent.year);
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