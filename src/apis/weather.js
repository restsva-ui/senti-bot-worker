// src/apis/weather.js
//
// НОВИЙ провайдер погоди: wttr.in
// Без API-ключів, простий JSON, працює з назвами міст і координатами.
// Експорти сумісні зі старим кодом: weatherIntent, weatherSummaryByPlace, weatherSummaryByCoords.

const WTTR_BASE = "https://wttr.in";

/* ───────────── ВИЗНАЧЕННЯ, ЧИ ЦЕ ЗАПИТ ПРО ПОГОДУ ───────────── */

export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  if (!s.trim()) return false;

  // укр / рос
  if (
    /погода|температур[аи]|яка сьогодні погода|яка погода|дощ|сніг|гроза/.test(s)
  )
    return true;
  if (/какая погода|погода в|какая сегодня погода/.test(s)) return true;

  // англ
  if (/weather|what's the weather|whats the weather|forecast/.test(s)) return true;

  // інші мови при потребі
  return false;
}

/* ───────────── ПАРСИНГ МІСТА З ФРАЗИ ───────────── */

function stripWeatherWords(text = "") {
  let lower = String(text || "").toLowerCase().trim();
  let original = String(text || "").trim();

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
    "какая погода в ",
    "какая погода у ",
    "какая сегодня погода в ",
    "какая сегодня погода у ",
    "какая сегодня погода ",
    "какая погода ",
    "погода в ",
    "погода у ",
    // англ
    "what's the weather in ",
    "what is the weather in ",
    "what's the weather like in ",
    "what's the weather like ",
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

function normalizePlaceName(place = "") {
  let s = String(place || "").trim();
  s = s.replace(/^(місто|город|city)\s+/i, "");
  s = s.replace(/[,;]+/g, " ");
  s = s.replace(/\s{2,}/g, " ");
  return s.trim();
}

function extractPlaceFromText(text = "") {
  const stripped = stripWeatherWords(text);
  const norm = normalizePlaceName(stripped);
  return norm;
}

/* ───────────── РОБОТА З wttr.in ───────────── */

async function fetchWttrJson(path) {
  // path: "Kyiv" або "50.45,30.52"
  const url = `${WTTR_BASE}/${encodeURIComponent(path)}?format=j1`;
  const res = await fetch(url).catch(() => null);
  if (!res || !res.ok) {
    // це буде інтерпретовано як "помилка сервера погоди" у webhook
    throw new Error("weather-server");
  }
  const data = await res.json().catch(() => null);
  if (!data) {
    throw new Error("weather-no-data");
  }
  return data;
}

function summarizeFromWttrJson(data, lang = "uk") {
  const cc =
    data &&
    Array.isArray(data.current_condition) &&
    data.current_condition[0]
      ? data.current_condition[0]
      : null;

  if (!cc) {
    return lang === "ru"
      ? "Нет данных о погоде."
      : lang === "en"
      ? "No weather data."
      : "Немає даних про погоду.";
  }

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
  else if (/fog|туман/i.test(dLower)) icon = "🌫️";
  else if (/sun|ясно|clear/i.test(dLower)) icon = "☀️";

  const tPart =
    tempC === null
      ? ""
      : lang === "en"
      ? `${tempC}°C`
      : `${tempC}°C`;

  const windPart =
    wind == null
      ? ""
      : lang === "ru"
      ? `, ветер ${wind} км/ч`
      : lang === "en"
      ? `, wind ${wind} km/h`
      : `, вітер ${wind} км/год`;

  const descUa =
    lang === "ru" || lang === "en"
      ? desc
      : desc; // wttr.in сам дає англ опис; ми просто показуємо як є

  if (tPart && descUa) {
    return `${icon} ${descUa}, ${tPart}${windPart}`;
  }
  if (tPart) return `${icon} ${tPart}${windPart}`;
  if (descUa) return `${icon} ${descUa}${windPart}`;

  return lang === "ru"
    ? "Нет данных о погоде."
    : lang === "en"
    ? "No weather data."
    : "Немає даних про погоду.";
}

/* ───────────── ПУБЛІЧНІ ФУНКЦІЇ ДЛЯ Senti ───────────── */

/**
 * Погода за координатами (lat, lon).
 * Повертає об'єкт { text, mode }
 */
export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  const path = `${lat},${lon}`;
  const data = await fetchWttrJson(path);
  const summary = summarizeFromWttrJson(data, lang);

  return {
    text: summary,
    mode: "HTML",
  };
}

/**
 * Погода за фразою користувача (назва міста).
 * Сигнатура сумісна з існуючим кодом:
 *    weatherSummaryByPlace(env, userText, langHint?)
 */
export async function weatherSummaryByPlace(env, userText, langHint = "uk") {
  const lang = langHint || "uk";
  const place = extractPlaceFromText(userText);
  if (!place) {
    const msg =
      lang === "ru"
        ? "Не понял, для какого города показать погоду."
        : lang === "en"
        ? "I did not catch which city you mean."
        : "Не зрозумів, для якого міста показати погоду.";
    return { text: msg, mode: "HTML" };
  }

  const data = await fetchWttrJson(place);
  const summary = summarizeFromWttrJson(data, lang);

  const label =
    lang === "ru"
      ? `В ${place}:`
      : lang === "en"
      ? `In ${place}:`
      : `У ${place}:`;

  return {
    text: `${label} ${summary}`,
    mode: "HTML",
  };
}

/* ───────────── DEFAULT EXPORT ───────────── */

export default {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};
