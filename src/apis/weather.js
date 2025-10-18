// src/apis/weather.js
// Open-Meteo weather API — актуальна температура + підтримка кирилиці

const UA_CODE = "UA";
const DEFAULT_TZ = "Europe/Kyiv";

export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  return /погода|weather|дощ|опад|вітер|температур/i.test(s);
}

export function parsePlaceFromText(text = "") {
  const s = String(text || "");
  const re =
    /(?:\bв|у|в\s+місті|у\s+місті|in|at|à|en|bei|in der|in dem)\s+([\p{L}\-.' ]{2,50})/iu;
  const m = s.match(re);
  if (m?.[1]) return m[1].trim();
  const fb = s.match(/погода\s+(?:в|у)\s+([\p{L}\-.' ]{2,50})/iu);
  return fb?.[1]?.trim() || null;
}

async function geocode(name, { lang = "uk" } = {}) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/search?" +
    new URLSearchParams({
      name,
      count: "5",
      language: lang,
      format: "json",
    }).toString();

  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  const list = Array.isArray(data?.results) ? data.results : [];
  if (!list.length) return null;

  const ua = list.find((x) => x.country_code === UA_CODE) || list[0];
  return ua
    ? { lat: ua.latitude, lon: ua.longitude, name: ua.name, country: ua.country_code }
    : null;
}

async function fetchCurrent(lat, lon, tz = DEFAULT_TZ) {
  const url =
    "https://api.open-meteo.com/v1/forecast?" +
    new URLSearchParams({
      latitude: lat,
      longitude: lon,
      current: "temperature_2m,weather_code,wind_speed_10m",
      timezone: tz,
    }).toString();

  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  const cur = data?.current || {};
  return {
    temp: cur.temperature_2m,
    wind: cur.wind_speed_10m,
    code: cur.weather_code,
  };
}

function emoji(code) {
  if (code === 0) return "☀️";
  if ([1, 2, 3].includes(code)) return "🌤️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57, 61, 63, 65].includes(code)) return "🌧️";
  if ([66, 67, 80, 81, 82].includes(code)) return "🌦️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 97].includes(code)) return "⛈️";
  return "🌡️";
}

export async function weatherSummaryByCoords(env, lang, { lat, lon }) {
  const cur = await fetchCurrent(lat, lon);
  const em = emoji(cur.code);
  return `${em} Зараз близько ${Math.round(cur.temp)}°C, вітер ${Math.round(
    cur.wind
  )} м/с.`;
}

export async function weatherSummaryByPlace(env, lang, text) {
  let place = parsePlaceFromText(text) || "Київ";

  // 1-ша спроба кирилицею
  let g = await geocode(place, { lang: "uk" });

  // fallback: латинка
  if (!g && /[А-Яа-яЇїІіЄє]/.test(place)) {
    const latin = translitUAToLatin(place);
    g = await geocode(latin, { lang: "en" });
  }

  if (!g) return "Не вдалося знайти такий населений пункт.";

  const cur = await fetchCurrent(g.lat, g.lon);
  const em = emoji(cur.code);
  return `${em} У ${g.name} зараз близько ${Math.round(
    cur.temp
  )}°C, вітер ${Math.round(cur.wind)} м/с.`;
}

// спрощена транслітерація UA→EN
function translitUAToLatin(str = "") {
  const map = {
    а: "a",
    б: "b",
    в: "v",
    г: "h",
    ґ: "g",
    д: "d",
    е: "e",
    є: "ye",
    ж: "zh",
    з: "z",
    и: "y",
    і: "i",
    ї: "yi",
    й: "i",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ю: "yu",
    я: "ya",
  };
  return str
    .split("")
    .map((c) => map[c.toLowerCase()] || c)
    .join("");
}