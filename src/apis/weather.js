// src/apis/weather.js
// OpenStreetMap Nominatim + Open-Meteo (без ключів) + сумісні експорти під різні імпорти

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

// ── Геокодинг міста → { name, lat, lon, country } ───────────────────────────
export async function geocodeCity(city, lang = "uk") {
  const url =
    `${NOMINATIM}?format=json&q=${encodeURIComponent(city)}` +
    `&addressdetails=1&limit=1&accept-language=${lang}&namedetails=1`;

  const r = await fetch(url, { headers: { "User-Agent": "senti-bot" } });
  if (!r.ok) throw new Error(`geocode http ${r.status}`);
  const arr = await r.json();
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const it = arr[0];
  const name = it?.display_name?.split(",")[0]?.trim() || city;
  const lat = Number(it.lat), lon = Number(it.lon);
  const country = it?.address?.country || "";
  return { name, lat, lon, country };
}

// ── Парсер запиту про погоду (багатомовний) ─────────────────────────────────
// Уникаємо \p{L} — використовуємо явні діапазони Latin+Latin-1+Latin Extended + Cyrillic.
// Приклади: "погода у києві", "weather in kyiv", "météo à Paris", "Wetter in Berlin"
export function parseWeatherQuery(text = "") {
  const s = String(text || "").trim();
  if (!s) return null;

  // є тригер-слово?
  if (!/(?:\bпогода\b|\bweather\b|\bmétéo\b|\bwetter\b)/i.test(s)) return null;

  // спроба 1: після прийменника (в/у/in/at/à/en/bei/…)
  const cityRx = new RegExp(
    //    в|у|у місті|в городе|in|at|à|en|bei|in der|in dem
    "(?:\\bв\\b|\\bу\\b|\\bу\\s+місті\\b|\\bв\\s+городе\\b|\\bin\\b|\\bat\\b|\\bà\\b|\\ben\\b|\\bbei\\b|\\bin der\\b|\\bin dem\\b)\\s+" +
    // міста латиницею або кирилицею, дефіси, апостроф, крапка, пробіли
    "([A-Za-z\\u00C0-\\u024F\\u0400-\\u04FF\\-\\.\\'\\s]{2,50})",
    "i"
  );
  const m = s.match(cityRx);
  if (m && m[1]) {
    const city = m[1].replace(/^[^A-Za-z\u00C0-\u024F\u0400-\u04FF]+|[^A-Za-z\u00C0-\u024F\u0400-\u04FF]+$/g, "").trim();
    if (city) return city;
  }

  // спроба 2: "погода львів" / "weather kyiv"
  const alt = s.match(/(?:\bпогода\b|\bweather\b|\bmétéo\b|\bwetter\b)\s+([A-Za-z\u00C0-\u024F\u0400-\u04FF\-\.\'\s]{2,50})/i);
  if (alt && alt[1]) {
    const city = alt[1].replace(/^[^A-Za-z\u00C0-\u024F\u0400-\u04FF]+|[^A-Za-z\u00C0-\u024F\u0400-\u04FF]+$/g, "").trim();
    if (city) return city;
  }

  return null;
}

// ── Поточна погода за координатами ──────────────────────────────────────────
export async function weatherSummaryByLatLon(lat, lon, lang = "uk") {
  const url =
    `${OPEN_METEO}?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m,precipitation` +
    `&hourly=temperature_2m,precipitation_probability` +
    `&timezone=auto`; // локальний час для цієї локації

  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather http ${r.status}`);
  const data = await r.json();

  const tz = data?.timezone || "UTC";
  const cur = data?.current || {};
  const t = typeof cur.temperature_2m === "number" ? Math.round(cur.temperature_2m) : null;
  const wind = cur.wind_speed_10m;
  const code = cur.weather_code;
  const precip = cur.precipitation;

  const WMO = {
    0: "ясно", 1: "переважно ясно", 2: "мінлива хмарність", 3: "хмарно",
    45: "туман", 48: "паморозь",
    51: "морось слабка", 53: "морось", 55: "морось сильна",
    61: "дощ слабкий", 63: "дощ", 65: "дощ сильний",
    71: "сніг слабкий", 73: "сніг", 75: "сніг сильний",
    80: "зливи слабкі", 81: "зливи", 82: "зливи сильні",
    95: "гроза"
  };
  const desc = (code in WMO) ? WMO[code] : "погода";

  const parts = [];
  if (t !== null) parts.push(`${t}°C`);
  parts.push(desc);
  if (typeof wind === "number") parts.push(`вітер ${Math.round(wind)} м/с`);
  if (typeof precip === "number" && precip > 0) parts.push(`опади ${precip} мм`);

  return { text: parts.filter(Boolean).join(", "), timezone: tz };
}

// ── Місто → короткий рядок ──────────────────────────────────────────────────
export async function weatherByCity(city, lang = "uk") {
  const geo = await geocodeCity(city, lang);
  if (!geo) return null;
  const w = await weatherSummaryByLatLon(geo.lat, geo.lon, lang);
  return { city: geo.name, country: geo.country, ...w };
}

/* ────────────────────────────────────────────────────────────────────────────
   СУМІСНІ ЕКСПОРТИ (щоб не міняти існуючі імпорти у webhook.js):
   - weatherIntent(text, lang)         -> повертає {city} або null
   - weatherSummaryByPlace(city, lang) -> те саме, що weatherByCity
   - weatherSummaryByCoords(lat, lon)  -> те саме, що weatherSummaryByLatLon
--------------------------------------------------------------------------- */
export function weatherIntent(text, lang = "uk") {
  const city = parseWeatherQuery(text);
  return city ? { city } : null;
}

export async function weatherSummaryByPlace(city, lang = "uk") {
  return weatherByCity(city, lang);
}

export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  return weatherSummaryByLatLon(lat, lon, lang);
}