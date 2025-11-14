// src/apis/weather.js
//
// Провайдер погоди: wttr.in
// - Без API-ключів
// - Працює з назвами міст і з координатами
// - Повертає короткий текст + HTML-посилання на детальний прогноз
//
// Сумісний зі старим кодом Senti:
//   - export function weatherIntent(text)
//   - export async function weatherSummaryByPlace(env, userText, langHint?)
//   - export async function weatherSummaryByCoords(lat, lon, langHint?)
//   - export default { weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords }

const WTTR_BASE = "https://wttr.in";

/* ────────────────────── INTENT: це про погоду? ────────────────────── */

export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  if (!s.trim()) return false;

  // укр / рос
  if (
    /погода|температур[аи]|яка сьогодні погода|яка погода|дощ|сніг|гроза/.test(s)
  )
    return true;
  if (/какая погода|погода в|погода у|какая сегодня погода/.test(s)) return true;

  // англійська
  if (/weather|what's the weather|whats the weather|forecast/.test(s)) return true;

  // німецька / французька при потребі можна додати окремо
  return false;
}

/* ────────────────────── Парсинг міста з фрази ────────────────────── */

/**
 * Вирізає службові слова на початку фрази:
 * "яка сьогодні погода у києві" → "києві"
 * "weather in London" → "London"
 */
function stripWeatherWords(text = "") {
  const original = String(text || "").trim();
  const lower = original.toLowerCase();

  const patterns = [
    // українська
    "яка сьогодні погода в ",
    "яка сьогодні погода у ",
    "яка сьогодні погода ",
    "яка погода в ",
    "яка погода у ",
    "яка погода ",
    "погода в ",
    "погода у ",
    "погода ",

    // російська
    "какая сегодня погода в ",
    "какая сегодня погода у ",
    "какая сегодня погода ",
    "какая погода в ",
    "какая погода у ",
    "какая погода ",
    "погода в ",
    "погода у ",
    "погода ",

    // англійська
    "what's the weather like in ",
    "what is the weather like in ",
    "what's the weather in ",
    "what is the weather in ",
    "weather in ",
    "weather at ",
    "weather ",
  ];

  for (const p of patterns) {
    if (lower.startsWith(p)) {
      return original.slice(p.length).trim();
    }
  }

  return original;
}

/** Нормалізація назви: прибираємо "місто", "city", зайві коми, дубль-пробіли */
function normalizePlaceName(place = "") {
  let s = String(place || "").trim();
  s = s.replace(/^(місто|город|city)\s+/i, "");
  s = s.replace(/[,;]+/g, " ");
  s = s.replace(/\s{2,}/g, " ");
  return s.trim();
}

/** Остаточне витягування міста з тексту користувача */
function extractPlaceFromText(text = "") {
  const stripped = stripWeatherWords(text);
  return normalizePlaceName(stripped);
}

/* ────────────────────── Допоміжні: визначення мови ────────────────────── */

function detectLangFromText(text = "") {
  const s = String(text || "").toLowerCase();
  if (/[іїєґ]/.test(s)) return "uk";
  if (/[ыэёъ]/.test(s)) return "ru";
  if (/weather|today|tomorrow/.test(s)) return "en";
  if (/wetter|heute|morgen/.test(s)) return "de";
  if (/météo|meteo|aujourd'hui|demain/.test(s)) return "fr";
  return "uk"; // дефолт
}

/** Переклад коротких фраз за мовою */
function tr(map, lang = "uk") {
  return map[lang] || map.uk || Object.values(map)[0] || "";
}

/* ────────────────────── Робота з wttr.in ────────────────────── */

/**
 * Виклик wttr.in у JSON-форматі
 * @param {string} location - "Kyiv" або "50.45,30.52"
 * @param {string} lang    - "uk", "ru", "en", "de", "fr"
 */
async function fetchWttr(location, lang = "uk") {
  const loc = encodeURIComponent(location);
  const url = `${WTTR_BASE}/${loc}?format=j1&lang=${encodeURIComponent(lang)}`;

  const res = await fetch(url, {
    headers: {
      // wttr.in просить адекватний User-Agent
      "User-Agent": "SentiBot/1.0 (+https://senti.restsva.app)",
    },
  }).catch(() => null);

  if (!res || !res.ok) return null;

  try {
    const json = await res.json();
    return json;
  } catch {
    return null;
  }
}

/**
 * Формує короткий опис погоди з JSON wttr.in
 */
function summarizeFromWttrJson(data, lang = "uk") {
  if (!data || !Array.isArray(data.current_condition)) {
    return tr(
      {
        uk: "Немає даних про погоду.",
        ru: "Нет данных о погоде.",
        en: "No weather data.",
        de: "Keine Wetterdaten.",
        fr: "Pas de données météo.",
      },
      lang
    );
  }

  const cc = data.current_condition[0] || {};
  const tempC = cc.temp_C ?? cc.temp_C === 0 ? cc.temp_C : null;
  const wind = cc.windspeedKmph;
  const desc =
    (Array.isArray(cc.weatherDesc) && cc.weatherDesc[0]?.value) ||
    cc.weatherDesc ||
    "";

  let icon = "🌤️";
  const dLower = String(desc || "").toLowerCase();
  if (/гроза|thunder|storm/i.test(dLower)) icon = "⛈️";
  else if (/snow|сніг|снег/i.test(dLower)) icon = "🌨️";
  else if (/rain|дощ|дожд/i.test(dLower)) icon = "🌧️";
  else if (/cloud|хмар|облачно|пасмур/i.test(dLower)) icon = "☁️";
  else if (/mist|туман|fog/i.test(dLower)) icon = "🌫️";
  else if (/sun|ясно|clear/i.test(dLower)) icon = "☀️";

  const tempPart =
    tempC === null
      ? ""
      : tr(
          {
            uk: `${tempC}°C`,
            ru: `${tempC}°C`,
            en: `${tempC}°C`,
            de: `${tempC}°C`,
            fr: `${tempC}°C`,
          },
          lang
        );

  const windPart =
    wind == null
      ? ""
      : tr(
          {
            uk: `, вітер ${wind} км/год`,
            ru: `, ветер ${wind} км/ч`,
            en: `, wind ${wind} km/h`,
            de: `, Wind ${wind} km/h`,
            fr: `, vent ${wind} km/h`,
          },
          lang
        );

  const baseDesc =
    desc ||
    tr(
      {
        uk: "поточна погода",
        ru: "текущая погода",
        en: "current weather",
        de: "aktuelles Wetter",
        fr: "météo actuelle",
      },
      lang
    );

  let summary = `${icon} ${baseDesc}`;
  if (tempPart) summary += `, ${tempPart}`;
  if (windPart) summary += windPart;

  return summary;
}

/**
 * HTML-посилання на докладний прогноз для міста або координат
 */
function weatherLinkForLocation(location, lang = "uk") {
  const loc = encodeURIComponent(location);
  const url = `${WTTR_BASE}/${loc}`;
  const label = tr(
    {
      uk: "детальніше",
      ru: "подробнее",
      en: "details",
      de: "Details",
      fr: "détails",
    },
    lang
  );
  return ` <a href="${url}">↗ ${label}</a>`;
}

/* ────────────────────── Публічні функції ────────────────────── */

/**
 * Погода за координатами (для останньої локації / geo-share).
 * Використовується webhook'ом як fallback.
 */
export async function weatherSummaryByCoords(lat, lon, langHint = "uk") {
  const lang = langHint || "uk";
  const locationStr = `${lat},${lon}`;

  const data = await fetchWttr(locationStr, lang);
  if (!data) {
    return {
      text: tr(
        {
          uk: "⚠️ Не вдалося отримати погоду (помилка сервера погоди).",
          ru: "⚠️ Не удалось получить погоду (ошибка сервера погоды).",
          en: "⚠️ Failed to get weather (weather server error).",
          de: "⚠️ Wetter konnte nicht abgerufen werden (Serverfehler).",
          fr: "⚠️ Impossible d’obtenir la météo (erreur du serveur météo).",
        },
        lang
      ),
      mode: "HTML",
    };
  }

  const summary = summarizeFromWttrJson(data, lang);
  const link = weatherLinkForLocation(locationStr, lang);

  const prefix = tr(
    {
      uk: "На твоїй локації:",
      ru: "В твоей локации:",
      en: "At your location:",
      de: "An deinem Standort:",
      fr: "À ta position :",
    },
    lang
  );

  return {
    text: `${prefix} ${summary}${link}`,
    mode: "HTML",
  };
}

/**
 * Погода за текстом користувача: "Погода у Києві", "Weather in London"
 * env зараз не використовується, але лишений для сумісності з webhook.
 */
export async function weatherSummaryByPlace(env, userText, langHint = "uk") {
  const lang = detectLangFromText(userText || "") || langHint || "uk";
  const placeRaw = extractPlaceFromText(userText || "");

  if (!placeRaw) {
    return {
      text: tr(
        {
          uk: "Не зрозумів, для якого міста показати погоду.",
          ru: "Не понял, для какого города показать погоду.",
          en: "I did not catch which city you mean.",
          de: "Ich habe nicht verstanden, für welche Stadt das Wetter angezeigt werden soll.",
          fr: "Je n’ai pas compris pour quelle ville afficher la météo.",
        },
        lang
      ),
      mode: "HTML",
    };
  }

  const data = await fetchWttr(placeRaw, lang);

  if (!data) {
    // сервер wttr.in впав або недоступний
    return {
      text: tr(
        {
          uk: "⚠️ Не вдалося отримати погоду (помилка сервера погоди).",
          ru: "⚠️ Не удалось получить погоду (ошибка сервера погоды).",
          en: "⚠️ Failed to get weather (weather server error).",
          de: "⚠️ Wetter konnte nicht abgerufen werden (Serverfehler).",
          fr: "⚠️ Impossible d’obtenir la météo (erreur du serveur météo).",
        },
        lang
      ),
      mode: "HTML",
    };
  }

  // Дістаємо "людську" назву міста й країни.
  let cityName = placeRaw;
  let country = "";

  try {
    const area = Array.isArray(data.nearest_area) ? data.nearest_area[0] : null;
    if (area) {
      const aName =
        (Array.isArray(area.areaName) && area.areaName[0]?.value) ||
        area.areaName ||
        "";
      const cName =
        (Array.isArray(area.country) && area.country[0]?.value) ||
        area.country ||
        "";
      if (aName) cityName = aName;
      if (cName) country = cName;
    }
  } catch {
    // тихо ігноруємо
  }

  const summary = summarizeFromWttrJson(data, lang);
  const link = weatherLinkForLocation(placeRaw, lang);

  const preposition = tr(
    {
      uk: "У",
      ru: "В",
      en: "In",
      de: "In",
      fr: "À",
    },
    lang
  );

  const label = country ? `${preposition} ${cityName}, ${country}:` : `${preposition} ${cityName}:`;

  return {
    text: `${label} ${summary}${link}`,
    mode: "HTML",
  };
}

/* ────────────────────── Default export ────────────────────── */

export default {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};