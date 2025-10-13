// src/lib/intentRouter.js
// Виклик відповідного API за наміром + форматування відповіді

import { weatherByCity, formatWeather } from "./apis/weather.js";
import { getUsdUahRate, formatRate } from "./apis/rates.js";
import { fetchTopNews, formatNewsList } from "./apis/news.js";
import { getHolidays, formatHolidays } from "./apis/holidays.js";
import { wikiSummary, formatSummary } from "./apis/wiki.js";

export async function runIntent(intent) {
  switch (intent.type) {
    case "weather": {
      const city = intent.city || "Kyiv";
      const data = await weatherByCity(city, intent.lang);
      return formatWeather(data);
    }
    case "rates": {
      // У твоєму rates.js вже є getUsdUahRate() → використаємо як базу.
      if (intent.from === "USD" && (intent.to === "UAH" || !intent.to)) {
        const x = await getUsdUahRate();
        return formatRate(x);
      }
      // Якщо потрібно інші напрямки — тут легко розширити,
      // або зробити універсальний конвертер.
      const x = await getUsdUahRate(); // фолбек — USD→UAH
      return formatRate(x);
    }
    case "news": {
      const items = await fetchTopNews(intent.country, "general");
      return formatNewsList(items).slice(0, 1500); // TG безпечний розмір
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