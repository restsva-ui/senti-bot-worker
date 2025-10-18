// src/apis/weather.js
//
// Open-Meteo based weather helper.
// Фокусується на "зараз", коректному TZ і акуратному геокодуванні.

const UA_CODE = "UA";
const DEFAULT_TZ = "Europe/Kyiv";

// -----------------------------
// Intent + парсер міста з тексту
// -----------------------------
export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  if (!s) return false;
  // дуже прості тригери
  return (
    /погода|weather|дощ|опад|вітер|ветер|температур/i.test(s) ||
    /^яка.*погода\b/i.test(s)
  );
}

// Витягаємо назву населеного пункту з фраз типу:
// "погода у Києві", "погода в Вінниці", "погода у Lviv", "погода в Warsaw" тощо.
export function parsePlaceFromText(text = "") {
  const s = String(text || "");
  // Підтримка кількох мовних конструкцій "у/в/в місті/in/bei/in der"
  // Назва: дозволяємо літери, дефіс, крапку, апостроф та пробіли (2..50 символів)
  const re =
    /(?:\bв|у|у\s+місті|в\s+місті|in|at|à|en|bei|in der|in dem)\s+([\p{L}\-.\' ]{2,50})/iu;
  const m = s.match(re);
  if (m?.[1]) {
    return m[1].trim().replace(/\s+/g, " ");
  }
  // fallback: якщо просто одне слово після "погода"
  const fallback = s.match(/погода\s+(?:в|у)\s+([\p{L}\-.\' ]{2,50})/iu);
  if (fallback?.[1]) return fallback[1].trim();
  return null;
}

// -----------------------------
// Геокодування через Open-Meteo
// -----------------------------
async function geocodeOpenMeteo(name, { preferUA = true, lang = "uk" } = {}) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?" +
    new URLSearchParams({
      name: String(name || ""),
      count: "8",
      language: lang,
      format: "json",
    }).toString();

  const r = await fetch(url);
  if (!r.ok) throw new Error("geocoding failed");
  const data = await r.json().catch(() => null);
  const results = Array.isArray(data?.results) ? data.results : [];

  if (!results.length) return null;

  // 1) Першочергово — міста України
  let list = results;
  if (preferUA) {
    const ua = results.filter((x) => x.country_code === UA_CODE);
    if (ua.length) list = ua;
  }

  // 2) В пріоритеті населені пункти (feature_class 'P')
  list.sort((a, b) => {
    const aIsP = (a.feature_class || "").toUpperCase() === "P";
    const bIsP = (b.feature_class || "").toUpperCase() === "P";
    if (aIsP && !bIsP) return -1;
    if (!aIsP && bIsP) return 1;
    // ближче до центру країни не перевіряємо — беремо перший підходящий
    return 0;
  });

  const best = list[0];
  return best
    ? {
        name: best.name,
        lat: best.latitude,
        lon: best.longitude,
        country_code: best.country_code,
        admin1: best.admin1 || "",
      }
    : null;
}

// -----------------------------
// Запит погоди (поточні значення)
// -----------------------------
async function fetchCurrentWeather(lat, lon, tz = DEFAULT_TZ) {
  // Беремо тільки поточні значення: температура, вітер, опади + weather_code
  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current:
        "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
      hourly: "precipitation_probability,temperature_2m",
      timezone: tz || DEFAULT_TZ, // фіксований TZ
      forecast_days: "1",
    }).toString();

  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather http ${r.status}`);
  const data = await r.json().catch(() => null);

  const cur = data?.current || {};
  const hourly = data?.hourly || {};
  const nowTime = cur?.time;
  let precipProb = null;

  if (nowTime && Array.isArray(hourly?.time)) {
    const idx = hourly.time.indexOf(nowTime);
    if (idx >= 0 && Array.isArray(hourly.precipitation_probability)) {
      precipProb = hourly.precipitation_probability[idx];
    }
  }

  return {
    temperature: toNumber(cur.temperature_2m),
    feels: toNumber(cur.apparent_temperature),
    wind: toNumber(cur.wind_speed_10m),
    precipitation: toNumber(cur.precipitation),
    code: cur.weather_code,
    precipProb: toNumber(precipProb),
    time: nowTime,
    tz: data?.timezone || tz || DEFAULT_TZ,
  };
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function weatherEmoji(code) {
  // Мінімальна мапа іконок за weather_code
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "🌤️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57, 61, 63, 65].includes(code)) return "🌧️";
  if ([66, 67, 80, 81, 82].includes(code)) return "🌦️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 97].includes(code)) return "⛈️";
  return "🌡️";
}

function fmtTemp(t) {
  if (t == null) return "";
  const v = Math.round(t);
  return `${v}°C`;
}

function sentence(text) {
  let s = String(text || "").trim();
  if (!s) return s;
  s = s[0].toUpperCase() + s.slice(1);
  if (!/[.!?…]$/.test(s)) s += ".";
  return s;
}

// -----------------------------
// Публічні фасади
// -----------------------------
export async function weatherSummaryByCoords(lat, lon, { tz = DEFAULT_TZ, lang = "uk" } = {}) {
  const cur = await fetchCurrentWeather(lat, lon, tz);
  const em = weatherEmoji(cur.code);
  const parts = [];

  // Базовий текст
  let main = `Зараз ${fmtTemp(cur.temperature)}`;
  // feels like
  if (cur.feels != null && Math.abs(cur.feels - cur.temperature) >= 2) {
    main += ` (відчувається як ${fmtTemp(cur.feels)})`;
  }
  parts.push(main);

  // опади
  if (cur.precipitation != null && cur.precipitation > 0) {
    parts.push("йде дощ");
  } else if (cur.precipProb != null) {
    if (cur.precipProb >= 60) parts.push("вірогідні опади");
    else if (cur.precipProb >= 30) parts.push("можливі короткочасні опади");
    else parts.push("опадів не очікується");
  }

  // вітер
  if (cur.wind != null) {
    if (cur.wind < 4) parts.push("вітер слабкий");
    else if (cur.wind < 9) parts.push("вітер помірний");
    else parts.push("вітер поривчастий");
  }

  const text = `${em} ${sentence(parts.join(", "))}`;
  return { text, timezone: cur.tz || tz || DEFAULT_TZ, raw: cur };
}

export async function weatherSummaryByPlace(place, { lang = "uk", preferUA = true, tz = DEFAULT_TZ } = {}) {
  const g = await geocodeOpenMeteo(place, { preferUA, lang });
  if (!g) return { text: "Не вдалося знайти такий населений пункт.", timezone: tz };

  // Якщо Open-Meteо повернув свій TZ — використовуємо його; інакше фолбек
  const out = await weatherSummaryByCoords(g.lat, g.lon, { tz, lang });
  return out;
}