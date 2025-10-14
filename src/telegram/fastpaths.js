// src/telegram/fastpaths.js
import { sendHtml } from "./helpers.js";
import { formatWeatherInline, formatNews, formatRate, formatWiki, formatHolidays } from "./formatters.js";
import { weatherByCity } from "../lib/apis/weather.js";
import { getUsdUahRate } from "../lib/apis/rates.js";
import { fetchTopNews } from "../lib/apis/news.js";
import { getHolidays } from "../lib/apis/holidays.js";
import { wikiSummary } from "../lib/apis/wiki.js";
import { arrow } from "./helpers.js";

export async function handleFastPaths({ env, chatId, lang, text }) {
  if (!text || text.startsWith("/")) return null;

  // Погода: "погода Львів" / "weather Kyiv"
  let m = text.match(/^\s*(?:погода|weather)\s+(.+?)\s*$/i);
  if (m) {
    const city = m[1];
    const w = await weatherByCity(city);
    const html = formatWeatherInline(w, lang);
    await sendHtml(env, chatId, html);
    return "weather";
  }

  // Новини: "новини", "головні новини"
  if (/^новини$/i.test(text) || (/головн/i.test(text) && /новин/i.test(text))) {
    const list = await fetchTopNews(env.NEWS_API_KEY || "");
    const html = formatNews(list);
    await sendHtml(env, chatId, html || "Зараз не вдалось отримати новини.");
    return "news";
  }

  // Курс долара: "курс долара", "usd uah"
  if ((/курс/i.test(text) && /(usd|долар|долара)/i.test(text)) || /\busd\s*uah\b/i.test(text)) {
    const rate = await getUsdUahRate();
    await sendHtml(env, chatId, formatRate(rate));
    return "rate";
  }

  // Вікі: "вікі Тарас Шевченко" / "wiki Ada Lovelace"
  m = text.match(/^\s*(?:вікі|wiki)\s+(.+?)\s*$/i);
  if (m) {
    const q = m[1];
    const w = await wikiSummary(q, lang).catch(() => null);
    const html = formatWiki(w) || "Не знайшов статтю.";
    await sendHtml(env, chatId, html);
    return "wiki";
  }

  // Свята: "свята України 2026" / "державні свята 2026"
  if (/свят[аи]/i.test(text)) {
    const mY = text.match(/(20\d{2})/);
    const year = mY ? Number(mY[1]) : new Date().getFullYear();
    let list = [];
    try {
      list = await getHolidays("UA", year);
    } catch {
      try { list = await getHolidays(year); } catch {}
    }
    const html = (list && list.length) ? formatHolidays(list) + arrow("https://date.nager.at/") : "Немає даних про свята.";
    await sendHtml(env, chatId, html);
    return "holidays";
  }

  return null;
}
