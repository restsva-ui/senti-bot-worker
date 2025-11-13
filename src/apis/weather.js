// src/apis/weather.js
//
// Open-Meteo + розумний парсер міста.
// Відповідь містить короткий текст і мінімалістичну клікабельну стрілку ↗︎ (HTML).

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

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

  const SPECIAL = {
    "києві": "київ",
    "львові": "львів",
    "харкові": "харків",
    "дніпрі": "дніпро",
    "одесі": "одеса",
  };
  if (SPECIAL[s.toLowerCase()]) s = SPECIAL[s.toLowerCase()];

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
  const split = chunk.split(
    /\s(?:in|at|en|bei|à|au|aux|в|у)\s/i
  );
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
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
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

/** Короткий опис за поточного стану погоди */
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

  const d = (m) => desc[m] || desc.uk;
  const lang2 = lang.slice(0, 2);

  const tVal = Number.isFinite(curT) ? Math.round(curT) : null;
  const wVal = Number.isFinite(wind) ? Math.round(wind) : null;

  let parts = [`${icon} ${d(lang2)}`];
  if (tVal !== null) parts.push(`Температура близько ${tVal}°C`);
  if (wVal !== null) parts.push(`Вітер ${wVal} м/с`);

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
  const url =
    `${OM_FORECAST}?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&current_weather=true&timezone=auto`;

  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!data || !data.current_weather) {
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
  // env залишився в сигнатурі для сумісності з webhook, але тут не використовується
  let place = parsePlaceFromText(userText);
  if (!place) {
    return {
      text: lang.startsWith("uk")
        ? "Не вдалося розпізнати населений пункт."
        : "Could not detect a location.",
    };
  }

  let results = await smartGeocode(place, lang);
  if (!results.length) {
    return {
      text: lang.startsWith("uk")
        ? "Не вдалося знайти такий населений пункт."
        : "No such place found.",
    };
  }

  const normPlace = place.toLowerCase();
  // намагаємось знайти максимально точний матч за назвою
  let best =
    results.find((r) => (r.name || "").toLowerCase() === normPlace) ||
    results[0];

  const { latitude: lat, longitude: lon, name } = best;
  const base = await weatherSummaryByCoords(lat, lon, lang);

  const preMap = {
    uk: "У",
    ru: "В",
    en: "In",
    de: "In",
    fr: "À",
  };
  const pre = preMap[lang.slice(0, 2)] || "У";
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