// src/apis/weather.js
//
// Open-Meteo: https://open-meteo.com/
// Ми робимо: (1) простий intent, (2) парсинг місця з тексту,
// (3) геокодинг -> прогноз -> короткий підсумок,
// (4) лінк на детальний прогноз.

const OM_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";

/** ----- НОРМАЛІЗАЦІЯ ТОПОНІМІВ (укр./ru/en/de/fr) ----- */
function normalizePlace(raw = "") {
  let s = String(raw || "").trim();

  // прибираємо лапки, зайві пробіли
  s = s.replace(/[«»“”"']/g, "").replace(/\s+/g, " ");

  // прибираємо початкові прийменники типу "в/у/у місті/in/at/en/bei/in der ..."
  // (декілька мов і форм, без жодних небезпечних екранувань)
  s = s.replace(
    /^(?:в|у|у\s+місті|в\s+місті|в\s+городе|у\s+городі|in|at|en|bei|in der|im|à|au|aux)\s+/iu,
    ""
  );

  // дуже часті українські місцеві відмінки:
  // Львові -> Львів, Харкові -> Харків, Києві -> Київ, Вінниці -> Вінниця, Полтаві -> Полтава тощо
  const uaCases = [
    [/(єві)$/i, "їв"],      // Києві -> Київ
    [/(ові)$/i, "ів"],      // Львові/Харкові -> Львів/Харків
    [/ниці$/i, "ниця"],     // Вінниці -> Вінниця
    [/ті$/i, "та"],         // Полтаві -> Полтава (працює і для багатьох ін.)
    [/ді$/i, "да"],         // Кременчуці -> Кременчук (частково)
  ];
  for (const [rx, rep] of uaCases) {
    if (rx.test(s)) {
      s = s.replace(rx, rep);
      break;
    }
  }

  // спеціальні/нестандартні винятки
  const SPECIAL = {
    "києві": "київ",
    "львові": "львів",
    "харкові": "харків",
    "дніпрі": "дніпро",
    "одесі": "одеса",
  };
  if (SPECIAL[s.toLowerCase()]) s = SPECIAL[s.toLowerCase()];

  // обрізаємо лишні коми/крапки в хвості
  s = s.replace(/[.,;:!?]$/g, "");

  return s;
}

/** Витягнути назву населеного пункту з тексту (кілька мов) */
function parsePlaceFromText(text = "") {
  const s = String(text || "").trim();

  // приклади: "погода у Києві", "погода в Львові", "weather in New York today", "Wetter heute in Wien"
  const rx =
    /(?:погода|погоду|погоди|weather|wetter|météo)\s+(?:на|в|у|in|at|en|bei|à|au|aux)?\s*(.+)$/i;
  const m = s.match(rx);
  return m?.[1] ? normalizePlace(m[1]) : null;
}

/** Простий intent на "погоду" (будь-якою мовою) */
export function weatherIntent(text = "") {
  const s = String(text || "").toLowerCase();
  return /(погод|weather|wetter|météo)/i.test(s);
}

/** Геокодинг Open-Meteo */
async function geocode(place, lang = "uk") {
  const url =
    `${OM_GEOCODE}?name=${encodeURIComponent(place)}&count=5&language=${encodeURIComponent(lang)}&format=json`;
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results;
}

/** Якщо геокодинг нічого не дав — пробуємо ще раз з «підправленим» словом */
async function smartGeocode(place, lang = "uk") {
  let res = await geocode(place, lang);
  if (res.length) return res;

  // пробуємо додаткові підстановки для укр. локативів
  const tries = [];
  if (/(єві)$/i.test(place)) tries.push(place.replace(/єві$/i, "їв"));
  if (/(ові)$/i.test(place)) tries.push(place.replace(/ові$/i, "ів"));
  if (/ниці$/i.test(place))  tries.push(place.replace(/ниці$/i, "ниця"));

  for (const t of tries) {
    res = await geocode(t, lang);
    if (res.length) return res;
  }
  return [];
}

/** Короткий текст-підсумок з відповіді OM */
function summarizeWeather(json, lang = "uk") {
  const curT = json?.current?.temperature_2m;
  const code = json?.current?.weather_code;
  const wind = json?.current?.wind_speed_10m;

  // дуже прості описи за кодом погоди
  let icon = "🌤️";
  let desc = "";
  const W = Number(code);
  if ([0].includes(W))                 { icon = "☀️"; desc = {uk:"сонячно", ru:"солнечно", en:"sunny", de:"sonnig", fr:"ensoleillé"}; }
  else if ([1,2,3].includes(W))        { icon = "🌤️"; desc = {uk:"хмарно з проясненнями", ru:"переменная облачность", en:"partly cloudy", de:"wolkig", fr:"nuageux"}; }
  else if ([45,48].includes(W))        { icon = "🌫️"; desc = {uk:"туман", ru:"туман", en:"fog", de:"Nebel", fr:"brouillard"}; }
  else if ([51,53,55,56,57].includes(W)){ icon = "🌦️"; desc = {uk:"мряка/дощ", ru:"морось/дождь", en:"drizzle/rain", de:"Niesel/regen", fr:"bruine/pluie"}; }
  else if ([61,63,65,80,81,82].includes(W)){ icon = "🌧️"; desc = {uk:"дощ", ru:"дождь", en:"rain", de:"Regen", fr:"pluie"}; }
  else if ([71,73,75,77,85,86].includes(W)){ icon = "❄️"; desc = {uk:"сніг", ru:"снег", en:"snow", de:"Schnee", fr:"neige"}; }
  else if ([95,96,99].includes(W))     { icon = "⛈️"; desc = {uk:"гроза", ru:"гроза", en:"thunderstorm", de:"Gewitter", fr:"orage"}; }

  const d = (m) => (desc[m] || desc.uk);
  const text = `${icon} ${d(lang.slice(0,2)) || d("uk")}. Температура близько ${Math.round(curT)}°C. Вітер ${Math.round(wind)} м/с.`;
  return text;
}

/** Підсумок погоди за координатами */
export async function weatherSummaryByCoords(lat, lon, lang = "uk") {
  const url = `${OM_FORECAST}?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,weather_code,wind_speed_10m`
    + `&timezone=auto`;
  const r = await fetch(url);
  const data = await r.json().catch(() => null);
  if (!data) return { text: "⚠️ Weather API error." };

  const text = summarizeWeather(data, lang);
  const link = `https://open-meteo.com/en/#location=${lat},${lon}`;
  return { text: `${text}\n🔗 ${link}`, timezone: data.timezone || "UTC" };
}

/** Підсумок погоди за текстом-запитом (місто з фрази) */
export async function weatherSummaryByPlace(env, userText, lang = "uk") {
  let place = parsePlaceFromText(userText);
  if (!place) {
    // якщо користувач запитав тільки «яка погода?», пробуємо місто з профілю / або кидаємо помилку
    return { text: "Не вдалося знайти такий населений пункт." };
  }

  // геокодимо з розумними підстановками
  let results = await smartGeocode(place, lang);
  if (!results.length) {
    // остання спроба — без мови (іноді OM краще матчить англ.)
    results = await geocode(place, "en");
  }
  if (!results.length) return { text: "Не вдалося знайти такий населений пункт." };

  const best = results[0];
  const lat = best.latitude;
  const lon = best.longitude;
  const cityName = best.name;

  const { text, timezone } = await weatherSummaryByCoords(lat, lon, lang);
  // робимо підпис «у <місто>»
  const pre = { uk: "У", ru: "В", en: "In", de: "In", fr: "À" }[lang.slice(0,2)] || "У";
  return { text: text.replace(/^([^\s]+)/, `$1 ${pre} ${cityName}`), timezone };
}

export default {
  weatherIntent,
  weatherSummaryByPlace,
  weatherSummaryByCoords,
};