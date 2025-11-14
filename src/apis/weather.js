// src/apis/weather.js
//
// Open-Meteo + розумний парсер міста.
// Відповідь: короткий текст + мінімалістична клікабельна стрілка ↗︎ (HTML).

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** Просте визначення мови з тексту (uk / ru / en / de / fr) */
function detectLangFromText(text = "") {
  const s = String(text || "").toLowerCase();

  if (/[іїєґ]/i.test(s)) return "uk"; // явні українські
  if (/[ыэёъ]/i.test(s)) return "ru"; // явні російські

  if (/weather|today|tomorrow/i.test(s)) return "en";
  if (/wetter|heute|morgen/i.test(s)) return "de";
  if (/météo|meteo|aujourd'?hui|demain/i.test(s)) return "fr";

  return null;
}

/** Прибрати службові слова типу "погода в", "погода у", "weather in" тощо */
function stripWeatherWords(text = "") {
  let s = String(text || "").trim();
  const lower = s.toLowerCase();

  const patterns = [
    // uk
    "яка сьогодні погода в ",
    "яка сьогодні погода у ",
    "яка сьогодні погода ",
    "яка погода в ",
    "яка погода у ",
    "яка погода ",
    "погода в ",
    "погода у ",
    "погода ",
    // ru
    "какая сегодня погода в ",
    "какая сегодня погода у ",
    "какая сегодня погода ",
    "какая погода в ",
    "какая погода у ",
    "какая погода ",
    // en
    "what's the weather like in ",
    "what is the weather in ",
    "what's the weather in ",
    "weather in ",
    "weather at ",
    "weather ",
    // de
    "wie ist das wetter in ",
    "wie ist das wetter ",
    "wetter in ",
    "wetter ",
    // fr
    "quelle est la météo à ",
    "quelle est la meteo à ",
    "quelle est la météo ",
    "météo à ",
    "meteo à ",
    "météo ",
    "meteo ",
  ];

  for (const p of patterns) {
    if (lower.startsWith(p)) {
      return s.slice(p.length).trim();
    }
  }
  return s;
}

/** Нормалізація назви населеного пункту */
function normalizePlaceName(place = "") {
  let s = String(place || "").trim();

  // Прибрати "місто", "город", "city" на початку
  s = s.replace(/^(місто|город|city)\s+/i, "");

  // Класичні закінчення місцевого відмінку (Києві -> Київ)
  const map = {
    "києві": "київ",
    "львові": "львів",
    "харкові": "харків",
    "дніпрі": "дніпро",
    "одесі": "одеса",
    "киеве": "киев",
    "львове": "львов",
    "днепре": "днепр",
    "харькове": "харьков",
  };
  const lower = s.toLowerCase();
  if (map[lower]) s = map[lower];

  // Прибрати зайві роздільники
  s = s.replace(/[,;]+/g, " ");
  s = s.replace(/\s{2,}/g, " ");
  return s.trim();
}

/** Витягнути місто з фрази, з урахуванням мов */
function parsePlaceFromText(text = "", langHint = "uk") {
  const lang = detectLangFromText(text) || langHint || "uk";
  const stripped = stripWeatherWords(text);
  const normalized = normalizePlaceName(stripped);
  return { place: normalized, lang };
}

/** Текстовий опис погоди з урахуванням нового формату Open-Meteo */
function summarizeWeather(json, lang = "uk") {
  // Підтримуємо і новий формат (current), і старий (current_weather)
  const cw = json?.current || json?.current_weather || {};
  const curT = cw.temperature_2m ?? cw.temperature;
  const code = cw.weather_code ?? cw.weathercode;
  const wind = cw.wind_speed_10m ?? cw.windspeed;

  let icon = "🌤️";
  let desc = {
    uk: "хмарно з проясненнями",
    ru: "переменная облачность",
    en: "partly cloudy",
    de: "wolkig",
    fr: "nuageux",
  };

  const W = Number(code);

  if (W === 0 || W === 1) {
    icon = "☀️";
    desc = {
      uk: "ясно",
      ru: "ясно",
      en: "clear sky",
      de: "klar",
      fr: "ciel dégagé",
    };
  } else if (W === 2) {
    icon = "⛅";
    desc = {
      uk: "мінлива хмарність",
      ru: "переменная облачность",
      en: "partly cloudy",
      de: "teilweise bewölkt",
      fr: "partiellement nuageux",
    };
  } else if (W === 3) {
    icon = "☁️";
    desc = {
      uk: "хмарно",
      ru: "облачно",
      en: "overcast",
      de: "bedeckt",
      fr: "couvert",
    };
  } else if (W === 45 || W === 48) {
    icon = "🌫️";
    desc = {
      uk: "туман",
      ru: "туман",
      en: "fog",
      de: "Nebel",
      fr: "brouillard",
    };
  } else if ([51, 53, 55].includes(W)) {
    icon = "🌦️";
    desc = {
      uk: "мряка",
      ru: "морось",
      en: "drizzle",
      de: "Nieselregen",
      fr: "bruine",
    };
  } else if ([61, 63, 65, 80, 81, 82].includes(W)) {
    icon = "🌧️";
    desc = {
      uk: "дощ",
      ru: "дождь",
      en: "rain",
      de: "Regen",
      fr: "pluie",
    };
  } else if ([71, 73, 75, 77, 85, 86].includes(W)) {
    icon = "❄️";
    desc = {
      uk: "сніг",
      ru: "снег",
      en: "snow",
      de: "Schnee",
      fr: "neige",
    };
  } else if ([95, 96, 99].includes(W)) {
    icon = "⛈️";
    desc = {
      uk: "гроза",
      ru: "гроза",
      en: "thunderstorm",
      de: "Gewitter",
      fr: "orage",
    };
  }

  const tempText =
    curT === undefined || curT === null ? "" : `${curT}°C`;

  const windText =
    wind === undefined || wind === null
      ? ""
      : lang.startsWith("uk") || lang.startsWith("ru")
      ? `, вітер ${wind} км/год`
      : `, wind ${wind} km/h`;

  const base = [
    icon,
    desc[lang.slice(0, 2)] || desc.uk,
    tempText && `(${tempText})`,
  ]
    .filter(Boolean)
    .join(" ");

  return `${base}${windText}`;
}

/** Лінк ↗︎ на Open-Meteo / карту */
function weatherDeepLink(lat, lon, lang = "uk") {
  const url = `https://open-meteo.com/en/docs#location=${encodeURIComponent(
    `${lat},${lon}`
  )}`;
  const labelMap = {
    uk: "детальніше",
    ru: "подробнее",
    en: "details",
    de: "Details",
    fr: "détails",
  };
  const label = labelMap[lang.slice(0, 2)] || labelMap.uk;
  return `<a href="${url}">↗︎ ${label}</a>`;
}
/** Геокодування населеного пункту через Open-Meteо */
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

  if (!data || !Array.isArray(data.results)) return [];
  return data.results;
}

/** Прогноз за координатами (оновлений current=...) */
export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  const url =
    `${OM_FORECAST}?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,is_day&timezone=auto`;

  const r = await fetch(url);
  if (!r.ok) {
    return {
      text: lang.startsWith("uk")
        ? "⚠️ Не вдалося отримати погоду (помилка сервера погоди)."
        : "⚠️ Failed to fetch weather (weather server error).",
      mode: "HTML",
    };
  }

  const data = await r.json().catch(() => null);
  if (!data || (!data.current && !data.current_weather)) {
    return {
      text: lang.startsWith("uk")
        ? "⚠️ Не вдалося отримати погоду."
        : "⚠️ Failed to fetch weather.",
      mode: "HTML",
    };
  }

  const textCore = summarizeWeather(data, lang);
  const link = weatherDeepLink(lat, lon, lang);

  return {
    text: `${textCore}\n${link}`,
    mode: "HTML",
    timezone: data.timezone || "UTC",
  };
}

/** Прогноз за назвою міста / місця */
export async function weatherSummaryByPlace(env, userText, langHint = "uk") {
  const { place, lang } = parsePlaceFromText(userText, langHint || "uk");
  const effLang = lang || "uk";

  if (!place) {
    return {
      text:
        effLang === "ru"
          ? "Не понял, для какого города показать погоду."
          : effLang === "en"
          ? "I did not catch which city you mean."
          : effLang === "de"
          ? "Ich habe nicht verstanden, für welche Stadt das Wetter angezeigt werden soll."
          : effLang === "fr"
          ? "Je n’ai pas compris pour quelle ville afficher la météo."
          : "Не зрозумів, для якого міста показати погоду.",
      mode: "HTML",
    };
  }

  const normPlace = normalizePlaceName(place);
  const results = await geocodePlace(normPlace, effLang);
  if (!results.length) {
    return {
      text:
        effLang === "ru"
          ? `Не удалось найти погоду для «${normPlace}».`
          : effLang === "en"
          ? `Could not find weather for “${normPlace}”.`
          : effLang === "de"
          ? `Konnte kein Wetter für „${normPlace}“ finden.`
          : effLang === "fr"
          ? `Impossible de trouver la météo pour « ${normPlace} ».`
          : `Не вдалося знайти погоду для «${normPlace}».`,
      mode: "HTML",
    };
  }

  // пріоритет: точний збіг назви -> Україна -> перший елемент
  let best =
    results.find(
      (r) => (r.name || "").toLowerCase() === normPlace.toLowerCase()
    ) || results.find((r) => r.country_code === "UA") || results[0];

  const { latitude: lat, longitude: lon, name } = best;
  const base = await weatherSummaryByCoords(lat, lon, effLang);

  const preMap = {
    uk: "У",
    ru: "В",
    en: "In",
    de: "In",
    fr: "À",
  };
  const pre = preMap[effLang.slice(0, 2)] || "У";
  const label = `${pre} ${name || normPlace}`;

  return {
    text: `${label}: ${base.text}`,
    mode: base.mode,
    timezone: base.timezone,
  };
}

/** Визначення: чи це запит про погоду */
export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  if (!s.trim()) return false;

  // uk / ru
  if (
    /погода|температур[аи]|яка сьогодні погода|яка погода|какая погода|дождь|дощ|сніг|гроза/.test(
      s
    )
  )
    return true;

  // en
  if (/weather|forecast|what's the weather|whats the weather/.test(s))
    return true;

  // de
  if (/wetter|wie ist das wetter/.test(s)) return true;

  // fr
  if (/météo|meteo/.test(s)) return true;

  return false;
}

export default {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};
