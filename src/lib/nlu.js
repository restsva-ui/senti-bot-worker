// src/lib/nlu.js
// Легка NLU: визначення наміру з повідомлення користувача (uk/ru/en/de/fr)

const WHITESPACE = /\s+/g;

const CURRENCIES = {
  // ключові слова -> [from, to] або символічний код
  // uk/ru/en/de/fr
  usd: ["USD"], dollar: ["USD"], долар: ["USD"], доллар: ["USD"], $: ["USD"],
  eur: ["EUR"], euro: ["EUR"], євро: ["EUR"], евро: ["EUR"], "€": ["EUR"],
  pln: ["PLN"], злотий: ["PLN"], злотые: ["PLN"], zloty: ["PLN"]
};

// країна за мовою — для свят/новин як дефолт
const DEFAULT_COUNTRY_BY_LANG = { uk: "UA", ru: "RU", en: "US", de: "DE", fr: "FR" };

const RE = {
  // Погода
  weather: [
    /\bпогода(?:\s+в| у)?\s+([a-zA-Z\u0400-\u04FF\s-]{2,})/i,   // uk/ru
    /\bweather(?:\s+in)?\s+([a-zA-Z\s-]{2,})/i,
    /\bmeteo(?:\s+à| en)?\s+([a-zA-Z\u00C0-\u017F\s-]{2,})/i,
    /\bwetter(?:\s+in)?\s+([a-zA-Z\u00C0-\u017F\s-]{2,})/i,
  ],
  // Курси (курс долара, євро тощо)
  rates: [
    /\bкурс(?:\s+([а-яіїєґ]+))?(?:\s+до\s+грн| до гривні)?/i,
    /\brate\s+(usd|eur|pln)/i,
    /\bсколько\s+стоит\s+(доллар|евро|злотый)/i,
    /\bhow much is\s+(usd|eur|pln)/i,
  ],
  // Новини
  news: [
    /\bновини\b|\bновости\b|\bnews\b/i
  ],
  // Свята/вихідні
  holidays: [
    /\bсвята\b|\bпраздники\b|\bholidays\b/i
  ],
  // Вікі коротко
  wiki: [
    /\bхто такий\s+(.+)/i, // uk: "Хто такий Шевченко"
    /\bкто такой\s+(.+)/i, // ru
    /\bwho is\s+(.+)/i,
    /\bwer ist\s+(.+)/i,
    /\bqui est\s+(.+)/i
  ]
};

function pickCurrencyToken(t) {
  const s = t.toLowerCase();
  for (const k of Object.keys(CURRENCIES)) {
    if (s.includes(k)) return CURRENCIES[k][0];
  }
  // прямі коди
  if (/^usd|eur|pln$/i.test(s)) return s.toUpperCase();
  return null;
}

export function detectIntent(text, lang = "en") {
  const t = String(text || "").trim();
  if (!t) return { type: "none" };

  // WEATHER
  for (const r of RE.weather) {
    const m = t.match(r);
    if (m) {
      const city = m[1]?.replace(WHITESPACE, " ").trim();
      if (city) return { type: "weather", city, lang };
      return { type: "weather", city: null, lang };
    }
  }

  // RATES
  for (const r of RE.rates) {
    const m = t.match(r);
    if (m) {
      const tok = m[1] ? pickCurrencyToken(m[1]) : pickCurrencyToken(t);
      // Якщо юзер питає “курс долара” українською — очікуємо курс USD→UAH
      const to = lang === "uk" ? "UAH" : (lang === "ru" ? "RUB" : "USD");
      return { type: "rates", from: tok || "USD", to, lang };
    }
  }

  // NEWS
  for (const r of RE.news) {
    if (r.test(t)) {
      const country = DEFAULT_COUNTRY_BY_LANG[lang] || "US";
      return { type: "news", country, lang };
    }
  }

  // HOLIDAYS
  for (const r of RE.holidays) {
    if (r.test(t)) {
      const country = DEFAULT_COUNTRY_BY_LANG[lang] || "US";
      const year = new Date().getFullYear();
      return { type: "holidays", country, year, lang };
    }
  }

  // WIKI
  for (const r of RE.wiki) {
    const m = t.match(r);
    if (m) {
      const title = m[1].trim();
      return { type: "wiki", title, lang };
    }
  }

  // Якщо є слова “курс долара/евро…” без слова “курс”
  const maybeCur = pickCurrencyToken(t);
  if (maybeCur) {
    const to = lang === "uk" ? "UAH" : (lang === "ru" ? "RUB" : "USD");
    return { type: "rates", from: maybeCur, to, lang };
  }

  return { type: "none" };
}