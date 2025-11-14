// src/apis/weather.js
//
// Open-Meteo + розумний парсер міста.
// Відповідь містить короткий текст і мінімалістичну клікабельну стрілку ↗︎ (HTML).

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** Просте визначення мови з тексту (uk / ru / en / de / fr) */
function detectLangFromText(text = "") {
  const s = String(text || "").toLowerCase();

  // явні українські символи
  if (/[іїєґ]/i.test(s)) return "uk";
  // явні російські символи
  if (/[ыэёъ]/i.test(s)) return "ru";

  // ключові слова
  if (/weather|today|tomorrow/i.test(s)) return "en";
  if (/wetter|heute|morgen/i.test(s)) return "de";
  if (/météo|meteo|aujourd'?hui|demain/i.test(s)) return "fr";

  return null;
}

/** ---------- нормалізація / парсинг населеного пункту ---------- */

/** Прибрати службові слова типу "погода в", "погода у" тощо */
function stripWeatherWords(text = "", lang = "uk") {
  let s = String(text || "").trim();

  // Працюємо в нижньому регістрі для пошуку, але повертаємо оригінал
  const lower = s.toLowerCase();

  const patterns = [
    // українська
    "яка сьогодні погода в ",
    "яка сьогодні погода у ",
    "яка сьогодні погода ",
    "яка погода в ",
    "яка погода у ",
    "яка погода ",
    "погода в ",
    "погода у ",
    "погода ",
    // російська
    "какая погода в ",
    "какая погода у ",
    "какая сегодня погода в ",
    "какая сегодня погода у ",
    "какая сегодня погода ",
    "какая погода ",
    "погода в ",
    "погода у ",
    "погода ",
    // англійська
    "what's the weather in ",
    "what is the weather in ",
    "what's the weather like in ",
    "what's the weather like ",
    "weather in ",
    "weather at ",
    "weather ",
    // німецька
    "wie ist das wetter in ",
    "wie ist das wetter ",
    "wetter in ",
    "wetter ",
    // французька
    "quelle est la météo à ",
    "quelle est la météo ",
    "météo à ",
    "meteo à ",
    "météo ",
    "meteo ",
  ];

  for (const p of patterns) {
    if (lower.startsWith(p)) {
      // вирізаємо рівно ту кількість символів, що в патерні
      return s.slice(p.length).trim();
    }
  }

  return s;
}

/** Спрощена нормалізація міста: прибрати "місто", "city", зайві коми тощо */
function normalizePlaceName(place = "") {
  let s = String(place || "").trim();

  s = s.replace(/^(місто|город|city)\s+/i, "");
  s = s.replace(/[,;]+/g, " ");
  s = s.replace(/\s{2,}/g, " ");
  s = s.trim();

  return s;
}

/** Спроба витягнути місце з рядка запиту */
function parsePlaceFromText(text = "", lang = "uk") {
  const stripped = stripWeatherWords(text, lang);
  const normalized = normalizePlaceName(stripped);
  return normalized || "";
}

/** ---------- мапа описів погоди за weathercode ---------- */

const WEATHER_CODES = {
  0: {
    uk: "ясно",
    ru: "ясно",
    en: "clear sky",
    de: "klar",
    fr: "ciel dégagé",
  },
  1: {
    uk: "переважно ясно",
    ru: "в основном ясно",
    en: "mainly clear",
    de: "überwiegend klar",
    fr: "ciel plutôt dégagé",
  },
  2: {
    uk: "мінлива хмарність",
    ru: "переменная облачность",
    en: "partly cloudy",
    de: "teilweise bewölkt",
    fr: "partiellement nuageux",
  },
  3: {
    uk: "хмарно",
    ru: "облачно",
    en: "overcast",
    de: "bedeckt",
    fr: "couvert",
  },
  45: {
    uk: "туман",
    ru: "туман",
    en: "fog",
    de: "Nebel",
    fr: "brouillard",
  },
  48: {
    uk: "туман з відкладенням інею",
    ru: "изморозь",
    en: "depositing rime fog",
    de: "gefrierender Nebel",
    fr: "brouillard givrant",
  },
  51: {
    uk: "легка мряка",
    ru: "слабая морось",
    en: "light drizzle",
    de: "leichter Nieselregen",
    fr: "bruine légère",
  },
  53: {
    uk: "мряка",
    ru: "морось",
    en: "drizzle",
    de: "Nieselregen",
    fr: "bruine",
  },
  55: {
    uk: "сильна мряка",
    ru: "сильная морось",
    en: "dense drizzle",
    de: "starker Nieselregen",
    fr: "bruine forte",
  },
  61: {
    uk: "невеликий дощ",
    ru: "небольшой дождь",
    en: "light rain",
    de: "leichter Regen",
    fr: "pluie faible",
  },
  63: {
    uk: "дощ",
    ru: "дождь",
    en: "moderate rain",
    de: "mäßiger Regen",
    fr: "pluie modérée",
  },
  65: {
    uk: "сильний дощ",
    ru: "сильный дождь",
    en: "heavy rain",
    de: "starker Regen",
    fr: "pluie forte",
  },
  71: {
    uk: "невеликий сніг",
    ru: "небольшой снег",
    en: "light snow",
    de: "leichter Schnee",
    fr: "neige faible",
  },
  73: {
    uk: "сніг",
    ru: "снег",
    en: "snow",
    de: "Schnee",
    fr: "neige",
  },
  75: {
    uk: "сильний сніг",
    ru: "сильный снег",
    en: "heavy snow",
    de: "starker Schnee",
    fr: "forte neige",
  },
  80: {
    uk: "короткочасні дощі",
    ru: "кратковременные дожди",
    en: "rain showers",
    de: "Regenschauer",
    fr: "averses de pluie",
  },
  81: {
    uk: "сильні дощові зливи",
    ru: "сильные дожди",
    en: "heavy rain showers",
    de: "starke Regenschauer",
    fr: "fortes averses",
  },
  82: {
    uk: "зливи",
    ru: "ливень",
    en: "violent rain showers",
    de: "sehr starke Regenschauer",
    fr: "averses violentes",
  },
  95: {
    uk: "гроза",
    ru: "гроза",
    en: "thunderstorm",
    de: "Gewitter",
    fr: "orage",
  },
  96: {
    uk: "гроза з градом",
    ru: "гроза с градом",
    en: "thunderstorm with hail",
    de: "Gewitter mit Hagel",
    fr: "orage avec grêle",
  },
  99: {
    uk: "сильна гроза з градом",
    ru: "сильная гроза с градом",
    en: "severe thunderstorm with hail",
    de: "starkes Gewitter mit Hagel",
    fr: "fort orage avec grêle",
  },
};

function t(strMap, lang = "uk") {
  if (!strMap) return "";
  return strMap[lang] || strMap["uk"] || Object.values(strMap)[0] || "";
}

/** Формування короткого речення про погоду.
 * ПІДСИЛЕНО під новий формат Open-Meteo (json.current)
 */
function summarizeWeather(json, lang = "uk") {
  const cw = json?.current || json?.current_weather || {};
  const curT = cw.temperature_2m ?? cw.temperature;
  const code = cw.weather_code ?? cw.weathercode;
  const wind = cw.wind_speed_10m ?? cw.windspeed;

  let icon = "🌤️";
  const numCode = typeof code === "number" ? code : Number(code) || 0;

  if (numCode >= 80 && numCode <= 82) icon = "🌧️";
  else if (numCode >= 60 && numCode <= 69) icon = "🌦️";
  else if (numCode >= 70 && numCode <= 79) icon = "🌨️";
  else if (numCode >= 95) icon = "⛈️";
  else if (numCode >= 3 && numCode <= 3) icon = "☁️";
  else if (numCode === 45 || numCode === 48) icon = "🌫️";
  else if (numCode === 0 || numCode === 1) icon = "☀️";

  const desc = WEATHER_CODES[numCode]
    ? t(WEATHER_CODES[numCode], lang)
    : t(
        {
          uk: "поточна погода",
          ru: "текущая погода",
          en: "current weather",
          de: "aktuelles Wetter",
          fr: "météo actuelle",
        },
        lang
      );

  const tempPart =
    curT === undefined || curT === null
      ? ""
      : t(
          {
            uk: `${curT}°C`,
            ru: `${curT}°C`,
            en: `${curT}°C`,
            de: `${curT}°C`,
            fr: `${curT}°C`,
          },
          lang
        );

  const windPart =
    wind === undefined || wind === null
      ? ""
      : t(
          {
            uk: `, вітер ${wind} км/год`,
            ru: `, ветер ${wind} км/ч`,
            en: `, wind ${wind} km/h`,
            de: `, Wind ${wind} km/h`,
            fr: `, vent ${wind} km/h`,
          },
          lang
        );

  const base =
    tempPart && desc
      ? `${icon} ${desc}, ${tempPart}${windPart}`
      : tempPart || desc || "";

  return base || t({ uk: "Немає даних про погоду", ru: "Нет данных о погоде", en: "No weather data", de: "Keine Wetterdaten", fr: "Pas de données météo" }, lang);
}

/** Стрілка ↗︎ із лінком на Open-Meteo / карту */
function weatherDeepLink(lat, lon, lang = "uk") {
  const url = `https://open-meteo.com/en/docs#location=${encodeURIComponent(
    `${lat},${lon}`
  )}`;
  const label = t(
    {
      uk: "детальніше",
      ru: "подробнее",
      en: "details",
      de: "Details",
      fr: "détails",
    },
    lang
  );
  return ` <a href="${url}">↗︎ ${label}</a>`;
}

/** ---------- Основні функції для сценарію ---------- */

/** Прогноз за координатами (оновлений запит до Open-Meteo) */
export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  const url =
    `${OM_FORECAST}?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,is_day&timezone=auto`;

  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!data || (!data.current && !data.current_weather)) {
    return {
      text:
        lang === "ru"
          ? "Не удалось получить погоду."
          : lang === "en"
          ? "Failed to get weather."
          : lang === "de"
          ? "Wetter konnte nicht abgerufen werden."
          : lang === "fr"
          ? "Impossible d’obtenir la météo."
          : "Не вдалося отримати погоду.",
      mode: "HTML",
    };
  }

  const summary = summarizeWeather(data, lang);
  const link = weatherDeepLink(lat, lon, lang);

  return {
    text: `${summary}${link}`,
    mode: "HTML",
    timezone: data.timezone || "auto",
  };
}

/** Геокодування назви населеного пункту через Open-Meteo */
async function geocodePlace(place, lang = "uk") {
  const params = new URLSearchParams({
    name: place,
    count: "5",
    language: lang === "ru" ? "ru" : lang === "uk" ? "uk" : "en",
    format: "json",
  });

  const url = `${OM_GEOCODE}?${params.toString()}`;
  const r = await fetch(url);
  const data = await r.json().catch(() => null);

  if (!data || !Array.isArray(data.results) || !data.results.length) {
    return [];
  }

  return data.results;
}

/** Прогноз за назвою міста / місця */
export async function weatherSummaryByPlace(env, userText, langHint = "uk") {
  const autoLang = detectLangFromText(userText) || langHint || "uk";
  const placeRaw = parsePlaceFromText(userText, autoLang);
  if (!placeRaw) {
    return {
      text:
        autoLang === "ru"
          ? "Не понял, для какого города показать погоду."
          : autoLang === "en"
          ? "I did not catch which city you mean."
          : autoLang === "de"
          ? "Ich habe nicht verstanden, für welche Stadt das Wetter angezeigt werden soll."
          : autoLang === "fr"
          ? "Je n’ai pas compris pour quelle ville afficher la météo."
          : "Не зрозумів, для якого міста показати погоду.",
      mode: "HTML",
    };
  }

  const normPlace = normalizePlaceName(placeRaw);
  const results = await geocodePlace(normPlace, autoLang);
  if (!results.length) {
    return {
      text:
        autoLang === "ru"
          ? `Не удалось найти погоду для «${normPlace}».`
          : autoLang === "en"
          ? `Could not find weather for “${normPlace}”.`
          : autoLang === "de"
          ? `Konnte kein Wetter für „${normPlace}“ finden.`
          : autoLang === "fr"
          ? `Impossible de trouver la météo pour « ${normPlace} ».`
          : `Не вдалося знайти погоду для «${normPlace}».`,
      mode: "HTML",
    };
  }

  // Вибір найкращого кандидата:
  // 1) точний збіг назви
  // 2) якщо є варіант у UA — беремо його
  // 3) інакше перший в списку
  let best =
    results.find((r) => (r.name || "").toLowerCase() === normPlace.toLowerCase()) ||
    results.find((r) => r.country_code === "UA") ||
    results[0];

  const { latitude: lat, longitude: lon, name } = best;
  const base = await weatherSummaryByCoords(lat, lon, autoLang);

  const preMap = {
    uk: "У",
    ru: "В",
    en: "In",
    de: "In",
    fr: "À",
  };
  const pre = preMap[autoLang] || preMap["uk"];
  const label = `${pre} ${name || normPlace}`;

  return {
    text: `${label}: ${base.text}`,
    mode: base.mode,
    timezone: base.timezone,
  };
}

/** Інтент визначення: чи це запит про погоду */
export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  if (!s.trim()) return false;

  if (
    /погода|температур[аи]|яка сьогодні погода|яка погода|дощ|сніг|гроза/.test(s)
  )
    return true;
  if (/какая погода|погода в|какая сегодня погода/.test(s)) return true;
  if (/weather|what's the weather|whats the weather|forecast/.test(s)) return true;
  if (/wetter|wie ist das wetter/.test(s)) return true;
  if (/météo|meteo/.test(s)) return true;

  return false;
}

export default {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};
