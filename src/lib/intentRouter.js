// src/lib/intentRouter.js
// Senti-style intent router with multilingual (uk, ru, en, de, fr) and tiny arrow link (↗︎).

import { weatherByCity } from "./apis/weather.js";
import { getUsdUahRate } from "./apis/rates.js";
import { fetchTopNews } from "./apis/news.js";
import { getHolidays } from "./apis/holidays.js";
import { wikiSummary } from "./apis/wiki.js";

function guessLang(s = "") {
  s = String(s || "");
  if (/[а-яёіїєґ]/i.test(s)) return /[іїєґ]/i.test(s) ? "uk" : "ru";
  if (/[éèêëàâîïôûùç]/i.test(s)) return "fr";
  if (/[äöüß]/i.test(s)) return "de";
  if (/(wetter|feiertage|nachrichten)/i.test(s)) return "de";
  if (/(météo|meteo|fériés|actualités|nouvelles)/i.test(s)) return "fr";
  return "en";
}

const D = {
  en: {
    weather_now: (c) => `Weather in ${c} — now`,
    weather_desc: (t, f) => `Temperature: ${t}°C (feels like ${f}°C)`,
    wind: (v) => `Wind: ${v} km/h`,
    humidity: (h) => `Humidity: ${h}%`,
    rate: (v) => `USD → UAH: ${v}₴`,
    news_title: `Top news in Ukraine`,
    holidays_title: (cc, y) => `Public holidays ${cc} in ${y}`,
    wiki_fail: `Couldn't get the article 😕`,
    news_fail: `Couldn't get news 😕`,
    weather_fail: `Couldn't get weather 😕`,
    holidays_fail: `Couldn't get holidays 😕`,
  },
  uk: {
    weather_now: (c) => `Погода у ${c} — зараз`,
    weather_desc: (t, f) => `Температура: ${t}°C (відчувається як ${f}°C)`,
    wind: (v) => `Вітер: ${v} км/год`,
    humidity: (h) => `Вологість: ${h}%`,
    rate: (v) => `Курс USD → UAH: ${v}₴`,
    news_title: `Головні новини України`,
    holidays_title: (cc, y) => `Державні свята ${cc} у ${y}`,
    wiki_fail: `Не вдалося отримати статтю 😕`,
    news_fail: `Не вдалося отримати новини 😕`,
    weather_fail: `Не вдалося отримати погоду 😕`,
    holidays_fail: `Не вдалося отримати свята 😕`,
  },
  ru: {
    weather_now: (c) => `Погода в ${c} — сейчас`,
    weather_desc: (t, f) => `Температура: ${t}°C (ощущается как ${f}°C)`,
    wind: (v) => `Ветер: ${v} км/ч`,
    humidity: (h) => `Влажность: ${h}%`,
    rate: (v) => `Курс USD → UAH: ${v}₴`,
    news_title: `Главные новости Украины`,
    holidays_title: (cc, y) => `Государственные праздники ${cc} в ${y}`,
    wiki_fail: `Не удалось получить статью 😕`,
    news_fail: `Не удалось получить новости 😕`,
    weather_fail: `Не удалось получить погоду 😕`,
    holidays_fail: `Не удалось получить праздники 😕`,
  },
  de: {
    weather_now: (c) => `Wetter in ${c} — jetzt`,
    weather_desc: (t, f) => `Temperatur: ${t}°C (gefühlt ${f}°C)`,
    wind: (v) => `Wind: ${v} km/h`,
    humidity: (h) => `Luftfeuchtigkeit: ${h}%`,
    rate: (v) => `USD → UAH: ${v}₴`,
    news_title: `Top-Nachrichten aus der Ukraine`,
    holidays_title: (cc, y) => `Feiertage ${cc} ${y}`,
    wiki_fail: `Artikel konnte nicht geladen werden 😕`,
    news_fail: `Nachrichten konnten nicht geladen werden 😕`,
    weather_fail: `Wetter konnte nicht geladen werden 😕`,
    holidays_fail: `Feiertage konnten nicht geladen werden 😕`,
  },
  fr: {
    weather_now: (c) => `Météo à ${c} — maintenant`,
    weather_desc: (t, f) => `Température : ${t}°C (ressenti ${f}°C)`,
    wind: (v) => `Vent : ${v} km/h`,
    humidity: (h) => `Humidité : ${h}%`,
    rate: (v) => `Taux USD → UAH : ${v}₴`,
    news_title: `À la une en Ukraine`,
    holidays_title: (cc, y) => `Jours fériés ${cc} en ${y}`,
    wiki_fail: `Impossible d’obtenir l’article 😕`,
    news_fail: `Impossible de récupérer les actus 😕`,
    weather_fail: `Impossible de récupérer la météo 😕`,
    holidays_fail: `Impossible de récupérer les jours fériés 😕`,
  },
};

const tinyLink = (url) => ` <a href="${url}">↗︎</a>`;

// ───────────────────────────────
// TEXT-FIRST entry (для простих випадків)
// ───────────────────────────────
export async function handleIntent(text, env = {}) {
  const t = (text || "").trim();
  return await _byText(t, env);
}

async function _byText(t, env = {}, langHint) {
  const lang = (langHint && D[langHint]) ? langHint : guessLang(t);
  const L = D[lang] || D.en;

  // WEATHER
  if (/(погода|weather|wetter|météo|meteo)/i.test(t)) {
    try {
      let city = t
        .replace(/^(.*?)(погода|weather|wetter|météo|meteo)/i, "")
        .replace(/^(у|в|in|à|en)\s*/i, "")
        .trim();
      if (!city)
        city =
          lang === "uk" ? "Київ"
          : lang === "ru" ? "Киев"
          : lang === "de" ? "Wien"
          : lang === "fr" ? "Paris"
          : "Kyiv";

      const w = await weatherByCity(city);
      if (!w) return { mode: "HTML", text: L.weather_fail };

      const src = w.provider === "wttr.in" ? "https://wttr.in/" : "https://open-meteo.com/";
      const parts = [
        `🌤️ <b>${L.weather_now(w.city)}</b>`,
        w.desc ? `• ${w.desc}` : "",
        `• ${L.weather_desc(w.tempC, w.feelsLikeC)}`,
        `• ${L.wind(w.windKph)}`,
        `• ${L.humidity(w.humidity)}`,
      ];
      return { mode: "HTML", text: parts.filter(Boolean).join("\n") + tinyLink(src) };
    } catch {
      return { mode: "HTML", text: L.weather_fail };
    }
  }

  // USD RATE
  if (/(курс|гривн|долар|доллар|usd|exchange|taux|dollar|wechselkurs)/i.test(t)) {
    try {
      const rate = await getUsdUahRate();
      return { mode: "HTML", text: `💸 <b>${L.rate(Number(rate).toFixed(2))}</b>${tinyLink("https://bank.gov.ua/")}` };
    } catch {
      return { mode: "HTML", text: "😕" };
    }
  }

  // NEWS — короткий дайджест
  if (/(новин|новини|news|nachrichten|actus?|actualités|nouvelles)/i.test(t)) {
    try {
      const items = await fetchTopNews(env);
      if (!items?.length) return { mode: "HTML", text: `${D[lang].news_fail}${tinyLink("https://www.pravda.com.ua/")}` };
      const top3 = items.slice(0, 3).map((n, i) => `${i + 1}) ${n.title}`).join("\n");
      const jump = items[0]?.link || "https://www.pravda.com.ua/";
      return { mode: "HTML", text: `🗞️ <b>${L.news_title}</b>\n${top3}${tinyLink(jump)}` };
    } catch {
      return { mode: "HTML", text: `${L.news_fail}${tinyLink("https://www.pravda.com.ua/")}` };
    }
  }

  // HOLIDAYS
  if (/(свят|свята|holidays|feiertage|fériés)/i.test(t)) {
    try {
      const m = t.match(/20\d{2}/);
      const year = m ? Number(m[0]) : new Date().getFullYear();
      const country = /ua|укр|україн/i.test(t) ? "UA" : "UA";
      const items = await getHolidays(country, year);
      if (!items?.length) return { mode: "HTML", text: `${L.holidays_fail}${tinyLink("https://date.nager.at/")}` };
      const head = `🎉 <b>${L.holidays_title(country, year)}</b>`;
      const body = items.slice(0, 10).map(h => `• ${h.date} — ${h.name}`).join("\n");
      return { mode: "HTML", text: `${head}\n${body}${tinyLink("https://date.nager.at/")}` };
    } catch {
      return { mode: "HTML", text: `${L.holidays_fail}${tinyLink("https://date.nager.at/")}` };
    }
  }

  // WIKI
  if (/(хто такий|хто така|що таке|кто такой|кто такая|что такое|wiki|вікі|вики|wikipedia|wikipédia)/i.test(t)) {
    try {
      const q = t.replace(/хто такий|хто така|що таке|кто такой|кто такая|что такое|wiki|вікі|вики|wikipedia|wikipédia/gi, "").trim() || t;
      const langCode = lang === "ru" ? "ru" : lang === "uk" ? "uk" : lang === "de" ? "de" : lang === "fr" ? "fr" : "en";
      const w = await wikiSummary(q, langCode);
      if (!w) return { mode: "HTML", text: (D[lang]?.wiki_fail || D.en.wiki_fail) };
      const excerpt = w.extract && w.extract.length > 700 ? w.extract.slice(0, 700) + "…" : (w.extract || "");
      return { mode: "HTML", text: `📚 <b>${w.title}</b>\n${excerpt}${tinyLink(w.url)}` };
    } catch {
      return { mode: "HTML", text: (D[lang]?.wiki_fail || D.en.wiki_fail) };
    }
  }

  return null;
}

// ───────────────────────────────
// INTENT-FIRST entry (для detectIntent(...))
// Приймає структуру від NLU: { type, args?, lang? , text? , query? }
// ───────────────────────────────
export async function runIntent(intent = {}, env = {}) {
  if (!intent || typeof intent !== "object") return null;

  // якщо прийшов текст — використаємо текстовий шлях
  const rawText = intent.text || intent.query || intent.original || intent.raw || "";
  if (rawText && String(rawText).trim()) {
    const langHint = intent.lang || intent.langHint;
    return await _byText(String(rawText), env, langHint);
  }

  const lang = intent.lang || intent.langHint || "en";
  const L = D[lang] || D.en;
  const t = (intent.type || "").toLowerCase();
  const args = intent.args || intent.parameters || {};

  // нормалізатори типів
  const isRate = /(rate|rates?|usd|usd_uah|currency|fx)/i.test(t);
  const isWeather = /(weather|погода|meteo|wetter)/i.test(t);
  const isNews = /(news|новини|nachrichten|actus?|actualités|nouvelles)/i.test(t);
  const isHolidays = /(holidays|feiertage|свят|свята)/i.test(t);
  const isWiki = /(wiki|wikipedia|вікі|вики|who_is|what_is)/i.test(t);

  try {
    if (isRate) {
      const rate = await getUsdUahRate();
      return { mode: "HTML", text: `💸 <b>${L.rate(Number(rate).toFixed(2))}</b>${tinyLink("https://bank.gov.ua/")}` };
    }

    if (isWeather) {
      const city = args.city || args.location || args.place ||
        (lang === "uk" ? "Київ" : lang === "ru" ? "Киев" : lang === "de" ? "Wien" : lang === "fr" ? "Paris" : "Kyiv");
      const w = await weatherByCity(city);
      if (!w) return { mode: "HTML", text: D[lang]?.weather_fail || D.en.weather_fail };
      const src = w.provider === "wttr.in" ? "https://wttr.in/" : "https://open-meteo.com/";
      const parts = [
        `🌤️ <b>${(D[lang] || D.en).weather_now(w.city)}</b>`,
        w.desc ? `• ${w.desc}` : "",
        `• ${(D[lang] || D.en).weather_desc(w.tempC, w.feelsLikeC)}`,
        `• ${(D[lang] || D.en).wind(w.windKph)}`,
        `• ${(D[lang] || D.en).humidity(w.humidity)}`,
      ];
      return { mode: "HTML", text: parts.filter(Boolean).join("\n") + tinyLink(src) };
    }

    if (isNews) {
      const items = await fetchTopNews(env);
      if (!items?.length) return { mode: "HTML", text: `${(D[lang] || D.en).news_fail}${tinyLink("https://www.pravda.com.ua/")}` };
      const top3 = items.slice(0, 3).map((n, i) => `${i + 1}) ${n.title}`).join("\n");
      const jump = items[0]?.link || "https://www.pravda.com.ua/";
      return { mode: "HTML", text: `🗞️ <b>${(D[lang] || D.en).news_title}</b>\n${top3}${tinyLink(jump)}` };
    }

    if (isHolidays) {
      const year = Number(args.year) || new Date().getFullYear();
      const country = (args.country || args.cc || "UA").toUpperCase();
      const items = await getHolidays(country, year);
      if (!items?.length) return { mode: "HTML", text: `${(D[lang] || D.en).holidays_fail}${tinyLink("https://date.nager.at/")}` };
      const head = `🎉 <b>${(D[lang] || D.en).holidays_title(country, year)}</b>`;
      const body = items.slice(0, 10).map(h => `• ${h.date} — ${h.name}`).join("\n");
      return { mode: "HTML", text: `${head}\n${body}${tinyLink("https://date.nager.at/")}` };
    }

    if (isWiki) {
      const q = args.query || args.q || args.name || "Wikipedia";
      const code = lang === "ru" ? "ru" : lang === "uk" ? "uk" : lang === "de" ? "de" : lang === "fr" ? "fr" : "en";
      const w = await wikiSummary(q, code);
      if (!w) return { mode: "HTML", text: (D[lang]?.wiki_fail || D.en.wiki_fail) };
      const excerpt = w.extract && w.extract.length > 700 ? w.extract.slice(0, 700) + "…" : (w.extract || "");
      return { mode: "HTML", text: `📚 <b>${w.title}</b>\n${excerpt}${tinyLink(w.url)}` };
    }
  } catch {
    // мʼякий фолбек у випадку API-факапа
    return { mode: "HTML", text: "😕" };
  }

  // якщо тип невідомий — нічого не робимо (нехай вебхук піде у LLM)
  return null;
}