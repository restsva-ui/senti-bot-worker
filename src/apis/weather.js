// src/apis/weather.js
//
// Open-Meteo + розумний парсер міста.
// Відповідь містить короткий текст і мінімалістичну клікабельну стрілку ↗︎ (HTML).

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** ---------- утиліти ---------- */
function fmt(n, unit) {
  const x = Number(n);
  return Number.isFinite(x) ? `${Math.round(x)}${unit}` : "—";
}
function lang2(lang = "uk") {
  return String(lang || "uk").slice(0, 2).toLowerCase();
}

/** ---------- нормалізація топонімів (укр./ru/en/de/fr) ---------- */
function normalizePlace(raw = "") {
  let s = String(raw || "").trim();

  // прибираємо лапки/зайві пробіли/хвостову пунктуацію
  s = s.replace(/[«»“”"']/g, "").replace(/\s+/g, " ").replace(/[.,;:!?]$/g, "");

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
    [/таві$/i, "тава"], // Полтаві -> Полтава (на випадок опечаток)
    [/та$/i, "та"], // перестраховка проти дивних закінчень
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

/** Витягнути місто з фрази (багатомовно, бере «останній сегмент після in/в/у/à/…» і ріже слова типу today/heute/сьогодні/demain) */
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

/** Геокодер Open-Meteо */
async function geocode(place, lang = "uk") {
  const url =
    `${OM_GEOCODE}?name=${encodeURIComponent(place)}` +
    `&count=5&language=${encodeURIComponent(lang2(lang))}&format=json`;
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

/** Короткий опис за кодами погоди */
function summarizeWeather(json, lang = "uk") {
  // Prefer new "current" API; fallback to legacy "current_weather"
  const cur = json?.current || {};
  const legacy = json?.current_weather || {};

  const curT = (cur.temperature_2m ?? legacy.temperature);
  const wind = (cur.wind_speed_10m ?? legacy.windspeed);
  const code = (cur.weather_code ?? legacy.weathercode);

  let icon = "🌤️";
  let desc = { uk: "хмарно з проясненнями", ru: "переменная облачность", en: "partly cloudy", de: "wolkig", fr: "nuageux" };
  const W = Number(code);
  if ([0].includes(W))                 { icon = "☀️"; desc = {uk:"сонячно",ru:"солнечно",en:"sunny",de:"sonnig",fr:"ensoleillé"}; }
  else if ([45,48].includes(W))        { icon = "🌫️"; desc = {uk:"туман",ru:"туман",en:"fog",de:"Nebel",fr:"brouillard"}; }
  else if ([51,53,55,56,57].includes(W)){ icon = "🌦️"; desc = {uk:"мряка/дощ",ru:"морось/дождь",en:"drizzle/rain",de:"Niesel/regen",fr:"bruine/pluie"}; }
  else if ([61,63,65,80,81,82].includes(W)){ icon = "🌧️"; desc = {uk:"дощ",ru:"дождь",en:"rain",de:"Regen",fr:"pluie"}; }
  else if ([71,73,75,77,85,86].includes(W)){ icon = "❄️"; desc = {uk:"сніг",ru:"снег",en:"snow",de:"Schnee",fr:"neige"}; }
  else if ([95,96,99].includes(W))     { icon = "⛈️"; desc = {uk:"гроза",ru:"гроза",en:"thunderstorm",de:"Gewitter",fr:"orage"}; }

  const d = (m) => (desc[m] || desc.uk);
  const tStr = Number.isFinite(Number(curT)) ? Math.round(Number(curT)) : "—";
  const wStr = Number.isFinite(Number(wind)) ? Math.round(Number(wind)) : "—";
  return `${icon} ${d(lang.slice(0,2)) || d("uk")}. Температура близько ${tStr}°C. Вітер ${wStr} м/с.`;
}

/** Допоміжне: стабільне погодне посилання */
function weatherDeepLink(lat, lon) {
  // Windy: стабільний формат "?lat,lon,zoom"
  return `https://www.windy.com/?${lat},${lon},8`;
}

/** Прогноз за координатами */
export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  try {
    const url =
      `${OM_FORECAST}?latitude=${encodeURIComponent(lat)}` +
      `&longitude=${encodeURIComponent(lon)}` +
      `&current=temperature_2m,weather_code,wind_speed_10m` +
      `&timezone=auto`;
    const r = await fetch(url);
    const data = await r.json().catch(() => null);
    if (!data || !data.current) {
      return { text: "Погоду зараз не отримано.", mode: "Markdown" };
    }

    const text = summarizeWeather(data, lang);
    const wx = weatherDeepLink(lat, lon);
    const arrow = `<a href="${wx}">↗︎</a>`; // мінімалістична клікабельна стрілка
    return {
      text: `${text}\n${arrow}`,
      mode: "HTML",
      timezone: data.timezone || "UTC",
    };
  } catch {
    return { text: "Погоду зараз не отримано.", mode: "Markdown" };
  }
}

/** Прогноз за назвою міста (витягуємо з фрази) */
export async function weatherSummaryByPlace(env, userText, lang = "uk") {
  const placeRaw = parsePlaceFromText(userText);
  if (!placeRaw) return { text: "Не вдалося знайти такий населений пункт." };

  const results = await smartGeocode(placeRaw, lang);
  if (!results.length) return { text: "Не вдалося знайти такий населений пункт." };

  const best = results[0];
  const lat = best.latitude;
  const lon = best.longitude;
  const name = best.name || placeRaw;

  const out = await weatherSummaryByCoords(lat, lon, lang);
  // Не ламай перше слово відповіді — просто додай префікс із містом
  const pre = { uk: "У", ru: "В", en: "In", de: "In", fr: "À" }[lang2(lang)] || "У";
  const prefix = `<b>${pre} ${name}</b> — `;
  return {
    text: `${prefix}${out.text}`,
    mode: "HTML", // префікс жирним + стрілка з coords
    timezone: out.timezone,
  };
}

export default {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};
