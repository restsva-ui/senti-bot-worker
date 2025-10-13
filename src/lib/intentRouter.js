// src/lib/intentRouter.js
// Very small intent router demo. Plug your NLU here if needed.
import { weatherByCity, formatWeather } from "./apis/weather.js";
import { getUsdUahRate, formatUsdRate } from "./apis/rates.js";
import { fetchTopNews, formatNewsList } from "./apis/news.js";
import { getHolidays } from "./apis/holidays.js";
import { wikiSummary, formatWiki } from "./apis/wiki.js";

export async function handleIntent(text, env = {}) {
  const t = (text || "").trim();

  // Weather
  if (/погода|weather/i.test(t)) {
    const city = t.replace(/погода|weather/gi, "").trim() || "Київ";
    const w = await weatherByCity(city);
    return { mode: "HTML", text: formatWeather(w) };
  }

  // USD rate
  if (/курс|долар|usd|exchange/i.test(t)) {
    const rate = await getUsdUahRate();
    return { mode: "HTML", text: formatUsdRate(rate) };
  }

  // News
  if (/новин|новини|news/i.test(t)) {
    const items = await fetchTopNews(env);
    return { mode: "HTML", text: formatNewsList(items) };
  }

  // Holidays
  if (/свят|свята|holidays/i.test(t)) {
    const yearMatch = t.match(/20\d{2}/);
    const year = yearMatch ? Number(yearMatch[0]) : new Date().getFullYear();
    const country = /україн|ukrain|ua/i.test(t) ? "UA" : "UA";
    const items = await getHolidays(country, year);
    const head = `🎉 <b>Державні свята ${country} у ${year}</b>`;
    const body = items.slice(0, 10).map(h => `• ${h.date} — ${h.name}`).join("\n");
    const textRes = items.length ? `${head}\n${body}` : "Не вдалося отримати свята 😕";
    return { mode: "HTML", text: textRes };
  }

  // Wikipedia
  if (/хто такий|хто така|що таке|wiki|вікі/i.test(t)) {
    const q = t.replace(/хто такий|хто така|що таке|wiki|вікі/gi, "").trim() || t;
    const w = await wikiSummary(q, "uk");
    return { mode: "HTML", text: formatWiki(w) };
  }

  return null; // let higher layer decide e.g. LLM fallback
}