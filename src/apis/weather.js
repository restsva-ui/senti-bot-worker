// src/apis/weather.js
//
// Open-Meteo + розумний парсер міста.
// Відповідь містить короткий текст і мінімалістичну клікабельну стрілку ↗︎ (HTML).

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** Extract "current" values robustly from Open-Meteo JSON */
function extractCurrent(json) {
  if (json && json.current) {
    const t = json.current.temperature_2m ?? json.current.temperature;
    const w = json.current.wind_speed_10m ?? json.current.windspeed;
    const c = json.current.weather_code ?? json.current.weathercode;
    if (t !== undefined && w !== undefined && c !== undefined)
      return { t, w, c };
  }
  if (json && json.current_weather) {
    return {
      t: json.current_weather.temperature,
      w: json.current_weather.windspeed,
      c: json.current_weather.weathercode,
    };
  }
  return { t: NaN, w: NaN, c: 1 };
}

/** нормалізація топонімів */
function normalizePlace(raw = "") {
  let s = String(raw || "").trim();
  s = s.replace(/[«»“”"']/g, "").replace(/\s+/g, " ").replace(/[.,;:!?]$/g, "");
  s = s.replace(/^(?:в|у|у\s+місті|в\s+місті|in|at|en|bei|à|au|aux)\s+/iu, "");
  const uaCases = [
    [/(єві)$/i, "їв"],
    [/(ові)$/i, "ів"],
    [/ниці$/i, "ниця"],
    [/ті$/i, "та"],
  ];
  for (const [rx, rep] of uaCases) if (rx.test(s)) s = s.replace(rx, rep);
  const SPECIAL = { "києві": "київ", "львові": "львів", "харкові": "харків", "дніпрі": "дніпро", "одесі": "одеса" };
  if (SPECIAL[s.toLowerCase()]) s = SPECIAL[s.toLowerCase()];
  return s;
}

/** Витягнути місто з фрази */
function parsePlaceFromText(text = "") {
  const s = String(text || "").trim();
  const m = s.match(/(?:погода|weather|wetter|m[ée]t[ée]o|meteo|temps)\s+(.*)$/i);
  let chunk = m?.[1] || s;
  const split = chunk.split(/\s(?:in|at|en|bei|à|au|aux|в|у)\s/i);
  if (split.length > 1) chunk = split[split.length - 1];
  chunk = chunk.replace(/\b(сьогодні|today|heute|demain|tomorrow|morgen)\b/ig, "").trim();
  return chunk ? normalizePlace(chunk) : null;
}

export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  return /(погод|weather|wetter|météo|meteo|temps)/i.test(s);
}

async function geocode(place, lang = "uk") {
  const url = `${OM_GEOCODE}?name=${encodeURIComponent(place)}&count=5&language=${encodeURIComponent(lang)}&format=json`;
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  return Array.isArray(data?.results) ? data.results : [];
}

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
  return await geocode(place, "en");
}

function summarizeWeather(json, lang = "uk") {
  const { t, w, c } = extractCurrent(json);
  let icon = "🌤️";
  let desc = { uk: "хмарно з проясненнями", ru: "переменная облачность", en: "partly cloudy", de: "wolkig", fr: "nuageux" };
  const W = Number(c);
  if ([0].includes(W)) icon = "☀️";
  else if ([45,48].includes(W)) icon = "🌫️";
  else if ([51,53,55,56,57].includes(W)) icon = "🌦️";
  else if ([61,63,65,80,81,82].includes(W)) icon = "🌧️";
  else if ([71,73,75,77,85,86].includes(W)) icon = "❄️";
  else if ([95,96,99].includes(W)) icon = "⛈️";
  const tStr = Number.isFinite(t) ? Math.round(t) + "°C" : "—";
  const wStr = Number.isFinite(w) ? Math.round(w) + " м/с" : "—";
  return `${icon} ${desc[lang] || desc.uk}. Температура ${tStr}. Вітер ${wStr}.`;
}

function weatherDeepLink(lat, lon) {
  return `https://www.windy.com/?${lat},${lon},8`;
}

export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  const url = `${OM_FORECAST}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!data) return { text: "⚠️ Weather API error." };
  const text = summarizeWeather(data, lang);
  const wx = weatherDeepLink(lat, lon);
  return { text: `${text}\n<a href="${wx}">↗︎</a>`, mode: "HTML", timezone: data.timezone || "UTC" };
}

export async function weatherSummaryByPlace(env, userText, lang = "uk") {
  const place = parsePlaceFromText(userText);
  if (!place) return { text: "Не вдалося знайти такий населений пункт." };
  const results = await smartGeocode(place, lang);
  if (!results.length) return { text: "Не вдалося знайти такий населений пункт." };
  const best = results[0];
  const out = await weatherSummaryByCoords(best.latitude, best.longitude, lang);
  const pre = { uk: "У", ru: "В", en: "In", de: "In", fr: "À" }[lang.slice(0,2)] || "У";
  return { text: out.text.replace(/^([^\s]+)/, `$1 ${pre} ${best.name}`), mode: out.mode, timezone: out.timezone };
}

export default { weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords };