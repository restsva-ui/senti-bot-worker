// src/apis/weather.js
//
// Безключова погода через Open-Meteo.
// Виклик із webhook.js у тебе вже є: weatherSummaryByPlace(env, place, lang)

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

// нормалізація міста
function normalizePlace(raw = "") {
  let s = String(raw || "").trim();
  s = s.replace(/[«»“”"']/g, "").replace(/\s+/g, " ").replace(/[.,;:!?]$/g, "");
  return s;
}

async function geocode(place) {
  const q = normalizePlace(place);
  const url = `${OM_GEOCODE}?name=${encodeURIComponent(q)}&count=1&language=uk&format=json`;
  const r = await fetch(url);
  if (!r.ok) return null;
  const j = await r.json();
  if (!j?.results?.length) return null;
  return j.results[0]; // {name, latitude, longitude, country, ...}
}

async function fetchWeather(lat, lon) {
  const url =
    `${OM_FORECAST}?latitude=${lat}&longitude=${lon}` +
    `&current_weather=true&hourly=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) return null;
  return await r.json();
}

// мапа кодів погоди → текст
function weatherTextByCode(code, lang = "uk") {
  const W = Number(code);
  const dict = {
    uk: {
      0: "☀️ ясно",
      1: "🌤 переважно ясно",
      2: "☁️ хмарно",
      3: "☁️☁️ суцільна хмарність",
      45: "🌫 туман",
      48: "🌫 туман",
      51: "🌦 мряка",
      53: "🌦 мряка",
      55: "🌦 мряка",
      61: "🌧 дощ",
      63: "🌧 помірний дощ",
      65: "🌧 сильний дощ",
      71: "❄️ сніг",
      80: "🌦 зливи",
      95: "⛈ гроза"
    },
    en: {
      0: "☀️ clear",
      1: "🌤 mostly clear",
      2: "☁️ cloudy",
      3: "☁️ overcast",
      45: "🌫 fog",
      48: "🌫 fog",
      61: "🌧 rain",
      63: "🌧 moderate rain",
      65: "🌧 heavy rain",
      80: "🌦 showers"
    }
  };
  const langDict = dict[lang] || dict.uk;
  return langDict[W] || (lang === "uk" ? "🌤 погода змінна" : "🌤 variable weather");
}

export async function weatherSummaryByPlace(env, placeRaw, lang = "uk") {
  const place = normalizePlace(placeRaw || "");
  if (!place) {
    return { ok: false, text: lang.startsWith("uk") ? "Скажи місто 🙏" : "Tell me the city 🙏" };
  }

  const geo = await geocode(place);
  if (!geo) {
    return { ok: false, text: lang.startsWith("uk") ? `Не знайшов місто “${place}”` : `City “${place}” not found` };
  }

  const meteo = await fetchWeather(geo.latitude, geo.longitude);
  if (!meteo?.current_weather) {
    return { ok: false, text: lang.startsWith("uk") ? "Погода тимчасово недоступна" : "Weather temporarily unavailable" };
  }

  const cur = meteo.current_weather;
  const cond = weatherTextByCode(cur.weather_code, lang);
  const temp = typeof cur.temperature === "number" ? `${cur.temperature}°C` : "";
  const wind = typeof cur.windspeed === "number" ? `, вітер ${cur.windspeed} км/год` : "";

  const name = geo.name || place;
  const text =
    lang.startsWith("uk")
      ? `Погода в ${name}: ${cond}, ${temp}${wind}`
      : `Weather in ${name}: ${cond}, ${temp}${wind}`;

  return { ok: true, text };
}
