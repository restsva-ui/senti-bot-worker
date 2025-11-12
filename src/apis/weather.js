// src/apis/weather.js
//
// Open-Meteo: геокодер + поточна погода.
// Повертає короткий текст і стрілку ↗︎ (HTML) на Windy по координатах міста.
//
// Головні фікси:
//  - жодних шаблонних змінних у одинарних лапках (лише `backticks`);
//  - захист від NaN у температурі та вітрі;
//  - коректне посилання windy.com саме на місто;
//  - м’який парсер фраз на зразок "Яка погода у Вінниці завтра".

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** ---------------- Нормалізація топоніму ---------------- */
function normalizePlace(raw = "") {
  let s = String(raw || "").trim();

  // прибираємо лапки/зайву пунктуацію/подвійні пробіли
  s = s.replace(/[«»“”"']/g, "").replace(/\s+/g, " ").replace(/[.,;:!?]$/g, "");

  // локатив → називний (найчастіші)
  s = s
    .replace(/Вінниці$/i, "Вінниця")
    .replace(/Києві$/i, "Київ")
    .replace(/Львові$/i, "Львів")
    .replace(/Харкові$/i, "Харків")
    .replace(/Дніпрі$/i, "Дніпро");

  // прибираємо початкові прийменники
  s = s.replace(/^(?:в|у|у\s+місті|в\s+місті|in|at|en|bei|à|au|aux)\s+/iu, "");

  return s.trim();
}

/** Витягнути населений пункт із запиту користувача */
function parsePlaceFromText(text = "") {
  const s = String(text || "").trim();

  // якщо фраза містить ключ "погода ...", беремо хвіст
  const m = s.match(
    /(?:погод[аи]|weather|wetter|meteo|météo|forecast)\s+(.*)$/i
  );
  let tail = m?.[1] || s;

  // якщо є "в/у/in/at ..." — беремо праву частину
  const split = tail.split(/\s(?:в|у|in|at|en|bei|à|au|aux)\s/i);
  if (split.length > 1) tail = split[split.length - 1];

  // прибираємо слова про час (сьогодні/завтра тощо)
  tail = tail
    .replace(
      /\b(сьогодні|завтра|післязавтра|today|tomorrow|heute|morgen|demain)\b/gi,
      ""
    )
    .trim();

  return tail ? normalizePlace(tail) : null;
}

/** Чи виглядає фраза як намір про погоду */
export function weatherIntent(text = "") {
  return /(погод|weather|wetter|météo|meteo|forecast)/i.test(String(text || ""));
}
/** Геокодер Open-Meteо */
async function geocode(place, lang = "uk") {
  const url =
    `${OM_GEOCODE}?name=${encodeURIComponent(place)}` +
    `&count=5&language=${encodeURIComponent(lang)}&format=json`;
  const r = await fetch(url);
  const j = await r.json().catch(() => null);
  return Array.isArray(j?.results) ? j.results : [];
}

/** Smart-геокодер з 1–2 автопідстановками та fallback на англ. */
async function smartGeocode(place, lang = "uk") {
  let res = await geocode(place, lang);
  if (res.length) return res;

  // кілька евристичних підстановок для українського локативу
  const tries = [];
  if (/иці$/i.test(place)) tries.push(place.replace(/иці$/i, "иця")); // Вінниці → Вінниця
  if (/єві$/i.test(place)) tries.push(place.replace(/єві$/i, "їв"));   // Києві → Київ
  if (/ові$/i.test(place)) tries.push(place.replace(/ові$/i, "ів"));   // Львові → Львів

  for (const t of tries) {
    res = await geocode(t, lang);
    if (res.length) return res;
  }

  // останній шанс — англійська
  res = await geocode(place, "en");
  return res;
}

/** Безпечний друк числа */
function fmt(n) {
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v)) : "—";
}

/** Людський опис за кодом погоди */
function summaryByCode(code, lang = "uk") {
  const c = Number(code);
  let icon = "🌤️";
  let desc = {
    uk: "хмарно з проясненнями",
    ru: "переменная облачность",
    en: "partly cloudy",
    de: "wolkig",
    fr: "nuageux",
  };

  if (c === 0) {
    icon = "☀️";
    desc = { uk: "сонячно", ru: "солнечно", en: "sunny", de: "sonnig", fr: "ensoleillé" };
  } else if ([45, 48].includes(c)) {
    icon = "🌫️";
    desc = { uk: "туман", ru: "туман", en: "fog", de: "Nebel", fr: "brouillard" };
  } else if ([51,53,55,56,57].includes(c)) {
    icon = "🌦️";
    desc = { uk: "мряка/дощ", ru: "морось/дождь", en: "drizzle/rain", de: "Niesel/regen", fr: "bruine/pluie" };
  } else if ([61,63,65,80,81,82].includes(c)) {
    icon = "🌧️";
    desc = { uk: "дощ", ru: "дождь", en: "rain", de: "Regen", fr: "pluie" };
  } else if ([71,73,75,77,85,86].includes(c)) {
    icon = "❄️";
    desc = { uk: "сніг", ru: "снег", en: "snow", de: "Schnee", fr: "neige" };
  } else if ([95,96,99].includes(c)) {
    icon = "⛈️";
    desc = { uk: "гроза", ru: "гроза", en: "thunderstorm", de: "Gewitter", fr: "orage" };
  }

  const key = String(lang || "uk").slice(0, 2);
  return { icon, text: desc[key] || desc.uk };
}

/** Посилання на Windy за координатами */
function windyLink(lat, lon) {
  // формат windy.com/?lat,lon,zoom
  const ll = `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)},9`;
  return `https://www.windy.com/?${ll}`;
}
/** Прогноз за координатами (короткий опис) */
export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  const url =
    `${OM_FORECAST}?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`;

  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!data) return { text: "⚠️ Не вдалося отримати погоду." };

  const temp = fmt(data?.current?.temperature_2m);
  const wind = fmt(data?.current?.wind_speed_10m);
  const { icon, text } = summaryByCode(data?.current?.weather_code, lang);

  // ВАЖЛИВО: тільки шаблонні рядки в backticks — без одинарних лапок!
  const line = `${icon} ${text}. Температура близько ${temp}°C. Вітер ${wind} м/с.`;
  const arrow = `<a href="${windyLink(lat, lon)}">↗︎</a>`;

  return { text: `${line}\n${arrow}`, mode: "HTML", timezone: data.timezone || "UTC" };
}

/** Прогноз за назвою населеного пункту (з фрази користувача) */
export async function weatherSummaryByPlace(env, userText, lang = "uk") {
  const placeRaw = parsePlaceFromText(userText);
  if (!placeRaw) return { text: "Не вдалося розпізнати населений пункт." };

  const results = await smartGeocode(placeRaw, lang);
  if (!results.length) return { text: "Не вдалося знайти такий населений пункт." };

  const best = results[0];
  const { latitude: lat, longitude: lon, name } = best;

  const base = await weatherSummaryByCoords(lat, lon, lang);

  // Додаємо назву міста в заголовок рядка ("У Вінниці ...")
  const preByLang = {
    uk: "У", ru: "В", en: "In", de: "In", fr: "À"
  };
  const pre = preByLang[String(lang).slice(0, 2)] || "У";

  const patched = base.text.replace(/^/, `${pre} ${name} `);
  return { text: patched, mode: base.mode, timezone: base.timezone };
}

export default {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};