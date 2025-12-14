// src/apis/weather.js
// Погода через Open-Meteo (без ключів): геокодування + forecast.
// Важливо: тут є exports, які очікує webhook:
// - weatherIntent
// - weatherSummaryByLocation
// - weatherSummaryByText

const GEO = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST = "https://api.open-meteo.com/v1/forecast";

const UA = "uk";
const EN = "en";

function normLang(lang) {
  const l = String(lang || "").toLowerCase();
  if (l.startsWith("uk") || l.startsWith("ua")) return UA;
  return EN;
}

function clampText(s, max = 1200) {
  s = String(s ?? "");
  return s.length <= max ? s : s.slice(0, max) + "…";
}

async function safeJson(res) {
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { _raw: txt };
  }
}

// -------------------- INTENT --------------------
// Стара/нова логіка може очікувати або boolean, або об'єкт.
// Тому повертаємо об'єкт { hit, place } (а в boolean контексті він теж "truthy").
export function weatherIntent(text = "") {
  const t = String(text || "").trim();
  if (!t) return { hit: false };

  const reHit = /(погода|weather|температур|градус|дощ|злива|сніг|вітер|прогноз)/i;
  if (!reHit.test(t)) return { hit: false };

  // Спроба витягнути місто:
  // "погода в Києві", "яка погода у Львові", "weather in Berlin"
  let place = "";

  // UA: "в/у <слово/фраза>"
  const mUa = t.match(/\b(?:в|у)\s+([A-Za-zА-Яа-яІіЇїЄєҐґ'’\-\. ]{2,60})/i);
  if (mUa && mUa[1]) place = mUa[1].trim();

  // EN: "in <place>"
  if (!place) {
    const mEn = t.match(/\bin\s+([A-Za-z'’\-\. ]{2,60})/i);
    if (mEn && mEn[1]) place = mEn[1].trim();
  }

  // Приберемо “сьогодні/зараз/будь ласка” тощо на кінці
  place = place
    .replace(/[,!?]+$/g, "")
    .replace(/\b(сьогодні|зараз|будь ласка|плиз|please|now|today)\b/gi, "")
    .trim();

  return { hit: true, place: place || "" };
}

// -------------------- CORE API --------------------

async function geocode(place, lang = UA) {
  const u = new URL(GEO);
  u.searchParams.set("name", place);
  u.searchParams.set("count", "1");
  u.searchParams.set("language", normLang(lang));
  u.searchParams.set("format", "json");

  const r = await fetch(u.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });

  const d = await safeJson(r);
  if (!r.ok) return { ok: false, error: d?.error || d?._raw || `geocode_http_${r.status}` };

  const item = d?.results?.[0];
  if (!item) return { ok: false, error: "place_not_found" };

  return {
    ok: true,
    place: {
      name: item?.name,
      admin1: item?.admin1,
      country: item?.country,
      latitude: item?.latitude,
      longitude: item?.longitude,
      timezone: item?.timezone,
    },
  };
}

async function forecast(lat, lon) {
  const u = new URL(FORECAST);
  u.searchParams.set("latitude", String(lat));
  u.searchParams.set("longitude", String(lon));
  u.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code"
  );
  u.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weather_code"
  );
  u.searchParams.set("timezone", "auto");

  const r = await fetch(u.toString(), {
    method: "GET",
    headers: { accept: "application/json" },
  });

  const d = await safeJson(r);
  if (!r.ok) return { ok: false, error: d?.error || d?._raw || `forecast_http_${r.status}` };
  return { ok: true, data: d };
}

function codeToText(code, lang = UA) {
  const l = normLang(lang);
  const map = {
    0: { uk: "Ясно", en: "Clear" },
    1: { uk: "Переважно ясно", en: "Mainly clear" },
    2: { uk: "Мінлива хмарність", en: "Partly cloudy" },
    3: { uk: "Хмарно", en: "Overcast" },
    45: { uk: "Туман", en: "Fog" },
    48: { uk: "Паморозевий туман", en: "Rime fog" },
    51: { uk: "Легка мряка", en: "Light drizzle" },
    53: { uk: "Мряка", en: "Drizzle" },
    55: { uk: "Сильна мряка", en: "Dense drizzle" },
    61: { uk: "Легкий дощ", en: "Slight rain" },
    63: { uk: "Дощ", en: "Rain" },
    65: { uk: "Сильний дощ", en: "Heavy rain" },
    71: { uk: "Легкий сніг", en: "Slight snow" },
    73: { uk: "Сніг", en: "Snow" },
    75: { uk: "Сильний сніг", en: "Heavy snow" },
    80: { uk: "Короткі зливи", en: "Rain showers" },
    81: { uk: "Зливи", en: "Rain showers" },
    82: { uk: "Сильні зливи", en: "Violent showers" },
    95: { uk: "Гроза", en: "Thunderstorm" },
  };
  const v = map[Number(code)];
  if (!v) return l === UA ? "Невідомо" : "Unknown";
  return l === UA ? v.uk : v.en;
}

function fmtPlace(place) {
  return [place?.name, place?.admin1, place?.country].filter(Boolean).join(", ");
}

function formatSummary(place, data, lang = UA) {
  const l = normLang(lang);
  const cur = data?.current || {};
  const daily = data?.daily || {};

  const todayMax = daily?.temperature_2m_max?.[0];
  const todayMin = daily?.temperature_2m_min?.[0];
  const prec = daily?.precipitation_sum?.[0];
  const wcode = cur?.weather_code ?? daily?.weather_code?.[0];

  const header = fmtPlace(place);
  const cond = codeToText(wcode, l);

  if (l === UA) {
    return clampText(
      `${header}\n` +
        `Зараз: ${cur?.temperature_2m ?? "?"}°C (відчувається ${cur?.apparent_temperature ?? "?"}°C), ` +
        `${cond}. Вітер: ${cur?.wind_speed_10m ?? "?"} м/с.\n` +
        `Сьогодні: мін ${todayMin ?? "?"}°C, макс ${todayMax ?? "?"}°C, опади: ${prec ?? 0} мм.`
    );
  }

  return clampText(
    `${header}\n` +
      `Now: ${cur?.temperature_2m ?? "?"}°C (feels ${cur?.apparent_temperature ?? "?"}°C), ` +
      `${cond}. Wind: ${cur?.wind_speed_10m ?? "?"} m/s.\n` +
      `Today: min ${todayMin ?? "?"}°C, max ${todayMax ?? "?"}°C, precip: ${prec ?? 0} mm.`
  );
}

// Зведення по назві місця
export async function weatherSummaryByPlace(place, lang = UA) {
  place = String(place || "").trim();
  if (!place) return { text: "Вкажи місто/локацію." };

  const g = await geocode(place, lang);
  if (!g.ok) {
    if (g.error === "place_not_found") return { text: "Не знайшов таку локацію. Спробуй інше написання міста." };
    return { text: `Помилка геокодування: ${String(g.error)}` };
  }

  const f = await forecast(g.place.latitude, g.place.longitude);
  if (!f.ok) return { text: `Помилка прогнозу: ${String(f.error)}` };

  return { text: formatSummary(g.place, f.data, lang), place: g.place };
}

// Зведення по координатах
export async function weatherSummaryByCoords(lat, lon, lang = UA) {
  const f = await forecast(lat, lon);
  if (!f.ok) return { text: `Помилка прогнозу: ${String(f.error)}` };

  const place = { name: "Поточна локація", latitude: lat, longitude: lon };
  return { text: formatSummary(place, f.data, lang), place };
}

// -------------------- exports that webhook expects --------------------

// Ім'я 1: weatherSummaryByText(text, lang) або (env, text, lang)
export async function weatherSummaryByText(...args) {
  let text = args[0];
  let lang = args[1] || "uk";

  // якщо перший аргумент схожий на env — пропускаємо його
  if (args.length >= 2 && text && typeof text === "object" && ("BOT_TOKEN" in text || "SERVICE_HOST" in text || "AI" in text)) {
    text = args[1];
    lang = args[2] || "uk";
  }
  return await weatherSummaryByPlace(String(text || ""), String(lang || "uk"));
}

// Ім'я 2: weatherSummaryByLocation(location, lang) або (env, location, lang)
export async function weatherSummaryByLocation(...args) {
  let loc = args[0];
  let lang = args[1] || "uk";

  if (args.length >= 2 && loc && typeof loc === "object" && ("BOT_TOKEN" in loc || "SERVICE_HOST" in loc || "AI" in loc)) {
    loc = args[1];
    lang = args[2] || "uk";
  }

  // якщо рядок — це назва місця
  if (typeof loc === "string") return await weatherSummaryByPlace(loc, String(lang || "uk"));

  const lat = Number(loc?.latitude ?? loc?.lat);
  const lon = Number(loc?.longitude ?? loc?.lon);

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return await weatherSummaryByCoords(lat, lon, String(lang || "uk"));
  }

  const place = String(loc?.city ?? loc?.place ?? loc?.name ?? "").trim();
  if (place) return await weatherSummaryByPlace(place, String(lang || "uk"));

  return { text: "Не вдалося визначити локацію для погоди." };
}

export default {
  weatherIntent,
  weatherSummaryByText,
  weatherSummaryByLocation,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};