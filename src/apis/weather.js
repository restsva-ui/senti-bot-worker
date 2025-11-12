// src/apis/weather.js
//
// Open-Meteo + розумний парсер міста.
// Відповідь містить короткий текст і мінімалістичну клікабельну стрілку ↗︎ (HTML).

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** Extract "current" values robustly from Open-Meteo JSON */
function extractCurrent(json) {
  // New API: json.current.{temperature_2m,weather_code,wind_speed_10m}
  if (json && json.current && typeof json.current === "object") {
    const t = Number(json.current.temperature_2m);
    const w = Number(json.current.wind_speed_10m);
    const c = Number(json.current.weather_code);
    if (Number.isFinite(t) && Number.isFinite(w) && Number.isFinite(c)) {
      return { t, w, c };
    }
  }
  // Legacy: json.current_weather.{temperature,weathercode,windspeed}
  if (json && json.current_weather) {
    const t = Number(json.current_weather.temperature);
    const w = Number(json.current_weather.windspeed);
    const c = Number(json.current_weather.weathercode);
    if (Number.isFinite(t) && Number.isFinite(w) && Number.isFinite(c)) {
      return { t, w, c };
    }
  }
  // Fallback to nearest hourly step
  try {
    const times = json?.hourly?.time || [];
    const tArr  = json?.hourly?.temperature_2m || [];
    const wArr  = json?.hourly?.wind_speed_10m || json?.hourly?.windspeed_10m || [];
    const cArr  = json?.hourly?.weather_code || json?.hourly?.weathercode || [];
    if (times.length) {
      const nowIso = new Date().toISOString().slice(0,13); // YYYY-MM-DDTHH
      let bestIdx = 0, bestDiff = 1e9;
      for (let i=0;i<times.length;i++) {
        const t = times[i];
        const hour = t.slice(0,13);
        const d = hour === nowIso ? 0 : Math.abs(new Date(t).getTime() - Date.now());
        if (d < bestDiff) { bestDiff = d; bestIdx = i; }
      }
      const t = Number(tArr[bestIdx]);
      const w = Number(wArr[bestIdx]);
      const c = Number(cArr[bestIdx]);
      if (Number.isFinite(t) && Number.isFinite(w) && Number.isFinite(c)) {
        return { t, w, c };
      }
    }
  } catch {}
  return { t: NaN, w: NaN, c: 1 };
}

/** ---------- нормалізація топонімів (укр./ru/en/de/fr) ---------- */
function normalizePlace(raw = "") {
  let s = String(raw || "").trim();

  // прибираємо лапки/зайві пробіли/хвостову пунктуацію
  s = s.replace(/[«»“”"']/g, "").replace(/\s+/g, " ").replace(/[.,;:!?]$/g, "");

  // прибираємо початкові прийменники: "в/у/у місті/in/at/en/bei/à/au/aux/..."
  s = s.replace(/^(?:в|у|у\\s+місті|в\\s+місті|в\\s+городе|у\\s+городі|in|at|en|bei|in der|im|à|au|aux)\\s+/iu, "");

  // часті українські локативи -> називний
  const uaCases = [
    [/(єві)$/i, "їв"],   // Києві -> Київ
    [/(ові)$/i, "ів"],   // Львові/Харкові -> Львів/Харків
    [/ниці$/i, "ниця"],  // Вінниці -> Вінниця
    [/ті$/i, "та"],      // Полтаві -> Полтава
  ];
  for (const [rx, rep] of uaCases) {
    if (rx.test(s)) { s = s.replace(rx, rep); break; }
  }

  const SPECIAL = { "києві": "київ", "львові": "львів", "харкові": "харків", "дніпрі": "дніпро", "одесі": "одеса" };
  if (SPECIAL[s.toLowerCase()]) s = SPECIAL[s.toLowerCase()];

  return s;
}

/** Витягнути місто з фрази (багатомовно, бере «останній сегмент після in/в/у/à/…» і ріже слова типу today/heute/сьогодні/demain) */
function parsePlaceFromText(text = "") {
  const s = String(text || "").trim();

  // загальний хук на "погода/weather/wetter/météo/meteo/temps"
  const m = s.match(/(?:погода|погоду|погоди|weather|wetter|m[ée]t[ée]o|meteo|temps)\\s+(.*)$/i);
  let chunk = m?.[1] || s;

  // якщо є " in/в/у/à/au/en/bei " — беремо частину ПІСЛЯ останнього входження
  const split = chunk.split(/\\s(?:in|at|en|bei|à|au|aux|в|у)\\s/i);
  if (split.length > 1) chunk = split[split.length - 1];

  // прибираємо слова часу
  chunk = chunk
    .replace(/\\b(сьогодні|сегодня|today|heute|aujourd'?hui|oggi|demain|tomorrow|morgen)\\b/ig, "")
    .trim();

  return chunk ? normalizePlace(chunk) : null;
}

/** Intent на погоду */
export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  return /(погод|weather|wetter|météo|meteo|temps)/i.test(s);
}

/** Геокодер Open-Mетео */
async function geocode(place, lang = "uk") {
  const url = `${OM_GEOCODE}?name=${encodeURIComponent(place)}&count=5&language=${encodeURIComponent(lang)}&format=json";
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
  if (/ниці$/i.test(place))  tries.push(place.replace(/ниці$/i, "ниця"));

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
  const cur = extractCurrent(json);
  const curT = cur.t, wind = cur.w, code = cur.c;

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
  const tStr = Number.isFinite(curT) ? Math.round(curT) + "°C" : "—";
  const wStr = Number.isFinite(wind) ? Math.round(wind) + " м/с" : "—";
  return `${icon} ${d(lang.slice(0,2)) || d("uk")}. Температура близько ${tStr}. Вітер ${wStr}.`;
}

/** Допоміжне: стабільне погодне посилання */
function weatherDeepLink(lat, lon) {
  // Windy: стабільний формат "?lat,lon,zoom"
  const windy = `https://www.windy.com/?${lat},${lon},8`;
  // Якщо схочеш Ventusky — просто заміни на:
  // const ventusky = `https://www.ventusky.com/?p=${lat};${lon};8`;
  return windy;
}

/** Прогноз за координатами */
export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  const url = `${OM_FORECAST}?latitude=${lat}&longitude=${lon}` +
              `&current=temperature_2m,weather_code,wind_speed_10m` +
              `&hourly=temperature_2m,weather_code,wind_speed_10m` +
              `&timezone=auto`;
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!data) return { text: "⚠️ Weather API error." };

  const text = summarizeWeather(data, lang);

  const wx = weatherDeepLink(lat, lon);
  const arrow = `<a href="${wx}">↗︎</a>`;   // мінімалістична клікабельна стрілка
  return { text: `${text}\n${arrow}`, mode: "HTML", timezone: data.timezone || "UTC" };
}

/** Прогноз за назвою міста (витягуємо з фрази) */
export async function weatherSummaryByPlace(env, userText, lang = "uk") {
  let place = parsePlaceFromText(userText);
  if (!place) return { text: "Не вдалося знайти такий населений пункт." };

  let results = await smartGeocode(place, lang);
  if (!results.length) return { text: "Не вдалося знайти такий населений пункт." };

  const best = results[0];
  const { latitude: lat, longitude: lon, name } = best;

  const out = await weatherSummaryByCoords(lat, lon, lang);
  const pre = { uk: "У", ru: "В", en: "In", de: "In", fr: "À" }[lang.slice(0,2)] || "У";
  return { text: out.text.replace(/^([^\\s]+)/, `$1 ${pre} ${name}`), mode: out.mode, timezone: out.timezone };
}

export default {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};
