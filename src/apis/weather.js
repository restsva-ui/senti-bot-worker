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

/** ---------- нормалізація топонімів (укр./ru/en/de/fr) ---------- */
function normalizePlace(raw = "") {
  let s = String(raw || "").trim();

  // прибираємо лапки/зайві пробіли/хвостову пунктуацію
  s = s
    .replace(/[«»“”"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]$/g, "");

  // прибираємо початкові прийменники: "в/у/у місті/in/at/en/bei/à/au/aux/..."
  s = s.replace(
    /^(?:в|у|у\s+місті|в\s+місті|в\s+городе|у\s+городі|in|at|en|bei|in der|im|à|au|aux)\s+/iu,
    ""
  );

  // часті українські локативи -> називний
  const uaCases = [
    [/(єві)$/i, "їв"], // Києві -> Київ
    [/(ові)$/i, "ів"], // Львові/Харкові -> Львів/Харків
    [/ниці$/i, "ниця"], // Вінниці -> Вінниця
    [/ті$/i, "та"], // Полтаві -> Полтава (грубо, але ок)
  ];
  for (const [rx, rep] of uaCases) {
    if (rx.test(s)) {
      s = s.replace(rx, rep);
      break;
    }
  }

  // спец-кейси українських форм
  const SPECIAL_UA = {
    "києві": "київ",
    "львові": "львів",
    "харкові": "харків",
    "дніпрі": "дніпро",
    "одесі": "одеса",
  };
  if (SPECIAL_UA[s.toLowerCase()]) s = SPECIAL_UA[s.toLowerCase()];

  // спец-кейси російських форм у місцевому відмінку
  const SPECIAL_RU = {
    "киеве": "киев",
    "львове": "львов",
    "одессе": "одесса",
    "виннице": "винница",
    "днепре": "днепр",
    "харькове": "харьков",
  };
  if (SPECIAL_RU[s.toLowerCase()]) s = SPECIAL_RU[s.toLowerCase()];

  return s;
}

/** Витягнути місто з фрази (багатомовно) */
function parsePlaceFromText(text = "") {
  const s = String(text || "").trim();

  // загальний хук на "погода/weather/wetter/météo/meteo/temps"
  const m = s.match(
    /(?:погода|погоду|погоди|weather|wetter|m[ée]t[ée]o|meteo|temps)\s+(.*)$/i
  );
  let chunk = m?.[1] || s;

  // якщо є " in/в/у/à/au/en/bei " — беремо частину ПІСЛЯ останнього входження
  const split = chunk.split(/\s(?:in|at|en|bei|à|au|aux|в|у)\s/i);
  if (split.length > 1) chunk = split[split.length - 1];

  // прибираємо слова часу
  chunk = chunk
    .replace(
      /\b(сьогодні|сегодня|today|heute|aujourd'?hui|oggi|demain|tomorrow|morgen)\b/gi,
      ""
    )
    .trim();

  return chunk ? normalizePlace(chunk) : null;
}

/** Intent на погоду */
export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  return /(погод|weather|wetter|météo|meteo|temps)/i.test(s);
}

/** Геокодер Open-Meteo */
async function geocode(place, lang = "uk") {
  const url =
    `${OM_GEOCODE}?name=${encodeURIComponent(place)}` +
    `&count=10&language=${encodeURIComponent(lang)}&format=json`;

  let data = null;
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    data = await r.json().catch(() => null);
  } catch {
    return [];
  }
  return Array.isArray(data?.results) ? data.results : [];
}

/** Smart-геокодер (робить кілька автопідстановок) */
async function smartGeocode(place, lang = "uk") {
  let res = await geocode(place, lang);
  if (res.length) return res;

  const tries = [];
  if (/(єві)$/i.test(place)) tries.push(place.replace(/єві$/i, "їв"));
  if (/(ові)$/i.test(place)) tries.push(place.replace(/ові$/i, "ів"));
  if (/ниці$/i.test(place)) tries.push(place.replace(/ниці$/i, "ниця"));

  for (const t of tries) {
    res = await geocode(t, lang);
    if (res.length) return res;
  }

  // остання спроба — англійською
  res = await geocode(place, "en");
  return res;
}
/** Короткий опис за поточного стану погоди (локалізований текст) */
function summarizeWeather(json, lang = "uk") {
  const cw = json?.current_weather || {};
  const curT = cw.temperature;
  const code = cw.weathercode;
  const wind = cw.windspeed;

  let icon = "🌤️";
  let desc = {
    uk: "хмарно з проясненнями",
    ru: "переменная облачность",
    en: "partly cloudy",
    de: "wolkig",
    fr: "nuageux",
  };
  const W = Number(code);

  if ([0].includes(W)) {
    icon = "☀️";
    desc = {
      uk: "сонячно",
      ru: "солнечно",
      en: "sunny",
      de: "sonnig",
      fr: "ensoleillé",
    };
  } else if ([45, 48].includes(W)) {
    icon = "🌫️";
    desc = {
      uk: "туман",
      ru: "туман",
      en: "fog",
      de: "Nebel",
      fr: "brouillard",
    };
  } else if ([51, 53, 55, 56, 57].includes(W)) {
    icon = "🌦️";
    desc = {
      uk: "мряка/дощ",
      ru: "морось/дождь",
      en: "drizzle/rain",
      de: "Niesel/Regen",
      fr: "bruine/pluie",
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

  const lang2 = (lang || "uk").slice(0, 2);

  const phrase = {
    uk: {
      temp: (x) => `Температура близько ${x}°C`,
      wind: (x) => `Вітер ${x} м/с`,
    },
    ru: {
      temp: (x) => `Температура около ${x}°C`,
      wind: (x) => `Ветер ${x} м/с`,
    },
    en: {
      temp: (x) => `Temperature around ${x}°C`,
      wind: (x) => `Wind ${x} m/s`,
    },
    de: {
      temp: (x) => `Temperatur etwa ${x}°C`,
      wind: (x) => `Wind ${x} m/s`,
    },
    fr: {
      temp: (x) => `Température autour de ${x}°C`,
      wind: (x) => `Vent ${x} m/s`,
    },
  }[lang2] || {
    temp: (x) => `Температура близько ${x}°C`,
    wind: (x) => `Вітер ${x} м/с`,
  };

  const d = (m) => desc[m] || desc.uk;

  const tVal = Number.isFinite(curT) ? Math.round(curT) : null;
  const wVal = Number.isFinite(wind) ? Math.round(wind) : null;

  const parts = [`${icon} ${d(lang2)}`];
  if (tVal !== null) parts.push(phrase.temp(tVal));
  if (wVal !== null) parts.push(phrase.wind(wVal));

  return parts.join(". ") + ".";
}

/** Допоміжне: стабільне погодне посилання */
function weatherDeepLink(lat, lon) {
  // Windy: стабільний формат "?lat,lon,zoom"
  const ll = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)},9`;
  return `https://www.windy.com/?${ll}`;
}

/** Прогноз за координатами */
export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  const qs = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current_weather: "true",
    hourly: "temperature_2m,weathercode",
    timezone: "auto",
  });

  let data = null;

  try {
    const r = await fetch(`${OM_FORECAST}?${qs.toString()}`);
    if (!r.ok) {
      return {
        text: lang.startsWith("uk")
          ? "⚠️ Не вдалося отримати погоду (помилка сервера погоди)."
          : "⚠️ Failed to fetch weather (upstream error).",
      };
    }
    data = await r.json().catch(() => null);
  } catch {
    return {
      text: lang.startsWith("uk")
        ? "⚠️ Не вдалося отримати погоду (помилка мережі)."
        : "⚠️ Failed to fetch weather (network error).",
    };
  }

  if (!data) {
    return {
      text: lang.startsWith("uk")
        ? "⚠️ Не вдалося отримати погоду."
        : "⚠️ Failed to fetch weather.",
    };
  }

  // Якщо current_weather відсутній — синтезуємо його з hourly
  if (!data.current_weather && data.hourly && Array.isArray(data.hourly.time)) {
    const times = data.hourly.time;
    const temps = data.hourly.temperature_2m || [];
    const codes = data.hourly.weathercode || [];

    const now = Date.now();
    let bestIdx = -1;
    let bestDiff = Infinity;

    for (let i = 0; i < times.length; i++) {
      const t = Date.parse(times[i]);
      if (Number.isNaN(t)) continue;
      const diff = Math.abs(t - now);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      data.current_weather = {
        temperature: temps[bestIdx],
        weathercode: codes[bestIdx],
        windspeed: undefined,
      };
    }
  }

  if (!data.current_weather) {
    return {
      text: lang.startsWith("uk")
        ? "⚠️ Не вдалося отримати погоду."
        : "⚠️ Failed to fetch weather.",
    };
  }

  const textCore = summarizeWeather(data, lang);
  const wx = weatherDeepLink(lat, lon);
  const arrow = `<a href="${wx}">↗︎</a>`; // мінімалістична клікабельна стрілка

  return {
    text: `${textCore}\n${arrow}`,
    mode: "HTML",
    timezone: data.timezone || "UTC",
  };
}

/** Прогноз за назвою міста (витягуємо з фрази) */
export async function weatherSummaryByPlace(env, userText, lang = "uk") {
  // 0) локальний детектор мови, якщо pickReplyLanguage дав щось не те
  const autoLang = detectLangFromText(userText);
  const effLang = autoLang || lang || "uk";

  let place = parsePlaceFromText(userText);
  if (!place) {
    return {
      text: effLang.startsWith("uk")
        ? "Не вдалося розпізнати населений пункт."
        : effLang.startsWith("ru")
        ? "Не удалось распознать населённый пункт."
        : "Could not detect a location.",
    };
  }

  let results = await smartGeocode(place, effLang);
  if (!results.length) {
    return {
      text: effLang.startsWith("uk")
        ? "Не вдалося знайти такий населений пункт."
        : effLang.startsWith("ru")
        ? "Не удалось найти такой населённый пункт."
        : "No such place found.",
    };
  }

  const normPlace = place.toLowerCase();

  // спочатку шукаємо точний матч за назвою,
  // потім — місто в Україні (щоб «Вінниця» не стрибала в іншу країну),
  // і лише потім беремо перший результат
  let best =
    results.find((r) => (r.name || "").toLowerCase() === normPlace) ||
    results.find((r) => r.country_code === "UA") ||
    results[0];

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
  const label = `${pre} ${name || place}`;

  // додаємо місто перед основним текстом
  return {
    text: `${label}: ${base.text}`,
    mode: base.mode,
    timezone: base.timezone,
  };
}

export default {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};
