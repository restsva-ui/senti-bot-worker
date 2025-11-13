// src/apis/weather.js
// Open-Meteo + розумний парсер міста.
// Короткий текст + мінімалістичне посилання на карту (Windy).

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

/**
 * Грубий детектор мови за текстом запиту.
 * Потрібен, щоб на російський запит відповідати російською, а на укр — українською.
 */
function detectLangFromText(text = "", fallback = "uk") {
  const s = String(text || "").toLowerCase();

  // явні російські маркери
  if (
    /[ыэё]/.test(s) ||
    /\b(какая|сейчас|сегодня|завтра|городе)\b/.test(s)
  ) {
    return "ru";
  }

  // явні українські маркери
  if (
    /[іїєґ]/.test(s) ||
    /\b(яка|сьогодні|завтра|місті|городі)\b/.test(s)
  ) {
    return "uk";
  }

  // простий хук на латинку
  if (/[a-z]/.test(s)) return "en";

  return (fallback || "uk").slice(0, 2);
}

/**
 * ---------- нормалізація топонімів (укр./ru/en/de/fr) ----------
 */
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
  ];
  for (const [rx, rep] of uaCases) {
    if (rx.test(s)) {
      s = s.replace(rx, rep);
      break;
    }
  }

  const SPECIAL = {
    "києві": "київ",
    "киеве": "киев",
    "львові": "львів",
    "харкові": "харків",
    "дніпрі": "дніпро",
    "одесі": "одеса",
    "черкасах": "черкаси",
  };
  if (SPECIAL[s.toLowerCase()]) s = SPECIAL[s.toLowerCase()];

  return s;
}

/**
 * Витягнути місто з фрази (багатомовно)
 */
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
/**
 * Геокодер Open-Meteo
 */
async function geocode(place, lang = "uk") {
  const url =
    `${OM_GEOCODE}?name=${encodeURIComponent(place)}` +
    `&count=10&language=${encodeURIComponent(lang)}&format=json`;

  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  return Array.isArray(data?.results) ? data.results : [];
}

/**
 * Smart-геокодер (робить кілька автопідстановок)
 */
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

/**
 * Короткий опис за поточного стану погоди
 */
function summarizeWeather(json, lang = "uk") {
  const cw = json?.current_weather || {};
  const curT = cw.temperature;
  const code = cw.weathercode;
  const wind = cw.windspeed;

  const W = Number(code);
  const lang2 = (lang || "uk").slice(0, 2);

  let icon = "🌤️";
  let descTable = {
    uk: "хмарно з проясненнями",
    ru: "переменная облачность",
    en: "partly cloudy",
    de: "wolkig",
    fr: "nuageux",
  };

  if ([0].includes(W)) {
    icon = "☀️";
    descTable = {
      uk: "сонячно",
      ru: "солнечно",
      en: "sunny",
      de: "sonnig",
      fr: "ensoleillé",
    };
  } else if ([45, 48].includes(W)) {
    descTable = {
      uk: "туман",
      ru: "туман",
      en: "fog",
      de: "Nebel",
      fr: "brouillard",
    };
  } else if ([51, 53, 55, 56, 57].includes(W)) {
    descTable = {
      uk: "мряка/дощ",
      ru: "морось/дождь",
      en: "drizzle/rain",
      de: "Niesel/Regen",
      fr: "bruine/pluie",
    };
  } else if ([61, 63, 65, 80, 81, 82].includes(W)) {
    descTable = {
      uk: "дощ",
      ru: "дождь",
      en: "rain",
      de: "Regen",
      fr: "pluie",
    };
  } else if ([71, 73, 75, 77, 85, 86].includes(W)) {
    icon = "❄️";
    descTable = {
      uk: "сніг",
      ru: "снег",
      en: "snow",
      de: "Schnee",
      fr: "neige",
    };
  } else if ([95, 96, 99].includes(W)) {
    icon = "⛈️";
    descTable = {
      uk: "гроза",
      ru: "гроза",
      en: "thunderstorm",
      de: "Gewitter",
      fr: "orage",
    };
  }

  const desc = descTable[lang2] || descTable.uk;

  const T = {
    uk: { temp: "Температура близько", wind: "Вітер", unitWind: "м/с" },
    ru: { temp: "Температура около", wind: "Ветер", unitWind: "м/с" },
    en: { temp: "Temperature around", wind: "Wind", unitWind: "m/s" },
    de: { temp: "Temperatur etwa", wind: "Wind", unitWind: "m/s" },
    fr: { temp: "Température autour de", wind: "Vent", unitWind: "m/s" },
  };
  const t = T[lang2] || T.uk;

  const parts = [`${icon} ${desc}`];

  if (Number.isFinite(curT)) {
    parts.push(`${t.temp} ${Math.round(curT)}°C`);
  }
  if (Number.isFinite(wind)) {
    parts.push(`${t.wind} ${Math.round(wind)} ${t.unitWind}`);
  }

  return parts.join(". ") + ".";
}

/**
 * Допоміжне: стабільне погодне посилання
 */
function weatherDeepLink(lat, lon) {
  // Windy: формат "?lat,lon,zoom"
  const ll = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)},9`;
  return `https://www.windy.com/?${ll}`;
}

/**
 * Вибір найкращого населеного пункту з результатів геокодера
 */
function pickBestLocation(results, place) {
  if (!Array.isArray(results) || !results.length) return null;

  const norm = String(place || "").toLowerCase();

  // 1) точний матч по назві
  let candidates = results.filter(
    (r) => String(r.name || "").toLowerCase() === norm
  );

  // 2) якщо немає — беремо ті, що починаються з назви
  if (!candidates.length) {
    candidates = results.filter((r) =>
      String(r.name || "").toLowerCase().startsWith(norm)
    );
  }

  // 3) якщо досі пусто — беремо всі
  if (!candidates.length) candidates = results;

  let best = candidates[0];

  for (const r of candidates) {
    const pop = Number(r.population || 0);
    const bestPop = Number(best.population || 0);

    const country = String(r.country_code || r.country || "").toUpperCase();
    const bestCountry = String(best.country_code || best.country || "").toUpperCase();

    const isUa = country === "UA" || country === "UKR";
    const bestIsUa = bestCountry === "UA" || bestCountry === "UKR";

    // спочатку віддаємо перевагу Україні, якщо запит по-українськи
    if (isUa && !bestIsUa) {
      best = r;
      continue;
    }

    // далі — за найбільшою population
    if (isUa === bestIsUa && pop > bestPop) {
      best = r;
    }
  }

  return best;
}
/**
 * Прогноз за координатами
 */
export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  const url =
    `${OM_FORECAST}?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&current_weather=true&timezone=auto`;

  const r = await fetch(url);
  const data = await r.json().catch(() => null);

  if (!data || !data.current_weather) {
    return {
      text: lang.startsWith("ru")
        ? "⚠️ Не удалось получить погоду."
        : lang.startsWith("en")
        ? "⚠️ Failed to fetch weather."
        : "⚠️ Не вдалося отримати погоду.",
    };
  }

  const textCore = summarizeWeather(data, lang);
  const wx = weatherDeepLink(lat, lon);

  // мінімалістична клікабельна стрілка
  const arrow = `<a href="${wx}">↗︎</a>`;

  return {
    text: `${textCore}\n${arrow}`,
    mode: "HTML",
    timezone: data.timezone || "UTC",
  };
}

/**
 * Прогноз за назвою міста (витягуємо з фрази)
 *
 * @param {Env} env  – залишений для сумісності з webhook, але тут не використовується
 * @param {string} userText – фраза користувача ("Яка завтра погода у Вінниці?")
 * @param {string} lang     – базова мова з KV, типово "uk"
 */
export async function weatherSummaryByPlace(env, userText, lang = "uk") {
  // Визначаємо мову зі свіжого тексту, щоб на російський запит відповідати російською
  const langDetected = detectLangFromText(userText, lang);
  let place = parsePlaceFromText(userText);

  if (!place) {
    return {
      text: langDetected === "ru"
        ? "Не удалось распознать населённый пункт."
        : langDetected === "en"
        ? "Could not detect a location."
        : "Не вдалося розпізнати населений пункт.",
    };
  }

  let results = await smartGeocode(place, langDetected);
  if (!results.length) {
    return {
      text: langDetected === "ru"
        ? "Не удалось найти такой населённый пункт."
        : langDetected === "en"
        ? "No such place found."
        : "Не вдалося знайти такий населений пункт.",
    };
  }

  const best = pickBestLocation(results, place) || results[0];
  const { latitude: lat, longitude: lon, name } = best;

  const base = await weatherSummaryByCoords(lat, lon, langDetected);

  const preMap = {
    uk: "У",
    ru: "В",
    en: "In",
    de: "In",
    fr: "À",
  };
  const pre = preMap[langDetected] || "У";

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