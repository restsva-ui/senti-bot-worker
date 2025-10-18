// src/apis/weather.js

// Невеличкі допоміжні локалізації
const L = {
  now: { uk: "Зараз", ru: "Сейчас", en: "Now", de: "Jetzt", fr: "Maintenant" },
  in:  { uk: "У",    ru: "В",       en: "In",  de: "In",   fr: "À" },
  wind:{ uk: "Вітер", ru: "Ветер",  en: "Wind",de: "Wind", fr: "Vent" },
  none:{ uk: "без опадів", ru: "без осадков", en: "no precipitation", de:"kein Niederschlag", fr:"pas de précipitations" },
  light:{ uk: "легкий", ru:"легкий", en:"light", de:"leicht", fr:"léger" },
  errorNotFound: {
    uk: "Не вдалося знайти такий населений пункт.",
    ru: "Не удалось найти такой населённый пункт.",
    en: "Could not find that place.",
    de: "Dieser Ort wurde nicht gefunden.",
    fr: "Impossible de trouver ce lieu."
  }
};

// ---- мапа кодів погоди Open-Meteo (скорочено, достатньо для стислого опису)
const WMO = (code, lang="uk") => {
  const map = {
    0:{ uk:"ясно", ru:"ясно", en:"clear", de:"klar", fr:"dégagé" },
    1:{ uk:"переважно ясно", ru:"в основном ясно", en:"mostly clear", de:"meist klar", fr:"plutôt dégagé" },
    2:{ uk:"хмарно з проясненнями", ru:"переменная облачность", en:"partly cloudy", de:"wolkig", fr:"partiellement nuageux" },
    3:{ uk:"хмарно", ru:"облачно", en:"overcast", de:"bewölkt", fr:"couvert" },
    45:{ uk:"туман", ru:"туман", en:"fog", de:"Nebel", fr:"brouillard" },
    48:{ uk:"туман з інеєм", ru:"изморозь, туман", en:"depositing rime fog", de:"Reifnebel", fr:"brouillard givrant" },
    51:{ uk:"дрібний дощ", ru:"слабая морось", en:"light drizzle", de:"leichter Nieselregen", fr:"bruine faible" },
    53:{ uk:"мряка", ru:"морось", en:"drizzle", de:"Nieselregen", fr:"bruine" },
    55:{ uk:"сильна мряка", ru:"сильная морось", en:"dense drizzle", de:"starker Niesel", fr:"bruine forte" },
    61:{ uk:"легкий дощ", ru:"слабый дождь", en:"light rain", de:"leichter Regen", fr:"pluie faible" },
    63:{ uk:"дощ", ru:"дождь", en:"rain", de:"Regen", fr:"pluie" },
    65:{ uk:"сильний дощ", ru:"сильный дождь", en:"heavy rain", de:"starker Regen", fr:"pluie forte" },
    71:{ uk:"легкий сніг", ru:"слабый снег", en:"light snow", de:"leichter Schnee", fr:"neige faible" },
    73:{ uk:"сніг", ru:"снег", en:"snow", de:"Schnee", fr:"neige" },
    75:{ uk:"сильний сніг", ru:"сильный снег", en:"heavy snow", de:"starker Schnee", fr:"fortes chutes de neige" },
    80:{ uk:"короткочасні дощі", ru:"ливни", en:"rain showers", de:"Regenschauer", fr:"averses" },
    95:{ uk:"гроза", ru:"гроза", en:"thunderstorm", de:"Gewitter", fr:"orage" }
  };
  return (map[code]?.[lang.slice(0,2)] || map[2]?.[lang.slice(0,2)]); // за замовчуванням "partly cloudy"
};

// ---- Витягнути місто з тексту (простий, але стійкий варіант)
function extractPlace(text = "") {
  const s = String(text).trim();

  // приклади: "у Києві", "в Львові", "в городе Одесса", "in New York", "bei Berlin"
  const m = s.match(
    /(?:у|в|в\sмісті|в\sгороде|in|at|en|bei|à|au|aux|nach|für)\s+([A-Za-z\u00C0-\u024F\u0400-\u04FF'’\-\. ]{2,50})/iu
  );
  if (m?.[1]) return m[1].trim();

  // запасний: якщо просто одне-дві слова після слова "погода"
  const m2 = s.match(/погода\s+(?:в|у)?\s*([A-Za-z\u00C0-\u024F\u0400-\u04FF'’\-\. ]{2,50})/iu);
  if (m2?.[1]) return m2[1].trim();

  return null;
}

// ---- Чи це інтенд погоди (стійко до комбінацій з "дата/час")
export function weatherIntent(text = "") {
  const s = String(text).trim().toLowerCase();
  if (!s) return false;

  const hasWeatherWord =
    s.includes("погода") || s.includes("weather") || s.includes("wetter") || s.includes("météo");

  const hasCombo =
    /(?:погода|weather|wetter|météo)\s*(?:і|та|и|and|und|et)\s*(?:дата|час|time|date)/i.test(s) ||
    /(?:дата|час|time|date)\s*(?:і|та|и|and|und|et)\s*(?:погода|weather|wetter|météo)/i.test(s);

  const hasPlace =
    /(?:у|в|in|bei|à|au|aux|nach|für)\s+[A-Za-z\u00C0-\u024F\u0400-\u04FF]/i.test(s);

  return hasWeatherWord || hasCombo || hasPlace;
}

// ---- Геокодинг через Open-Meteo
async function geocodePlace(place, lang = "uk") {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=${encodeURIComponent(lang)}&format=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("geocoding failed");
  const data = await r.json();
  const item = data?.results?.[0];
  if (!item) return null;
  return {
    name: item.name,
    country: item.country,
    lat: item.latitude,
    lon: item.longitude
  };
}

// ---- Отримати “зараз” по координатах
async function getCurrentWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,precipitation,wind_speed_10m,weather_code` +
    `&timezone=auto`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("weather failed");
  const data = await r.json();
  return {
    tz: data?.timezone || "UTC",
    t: data?.current?.temperature_2m,
    p: data?.current?.precipitation,
    w: data?.current?.wind_speed_10m,
    code: data?.current?.weather_code
  };
}

// ---- Форматування відповіді
function makeWeatherText({ placeLabel, t, p, w, code, lang="uk" }) {
  const flag = "🌤️";
  const cc = WMO(Number(code || 2), lang);
  const unitT = "°C";
  const windLabel = L.wind[lang.slice(0,2)] || L.wind.uk;

  // опади: якщо p дуже малі — вкажемо “без опадів”
  let precipText;
  if (p == null) precipText = "";
  else if (Number(p) < 0.2) precipText = L.none[lang.slice(0,2)] || L.none.uk;
  else precipText = `${p} mm`;

  const bits = [];
  bits.push(`${flag} ${L.in[lang.slice(0,2)] || L.in.uk} ${placeLabel} ${cc}.`);
  if (t != null) bits.push(`Температура близько ${Math.round(t)}${unitT}.`);
  if (w != null) bits.push(`${windLabel} ${Math.round(w)} м/с${precipText ? "," : "."}`);
  if (precipText) bits.push(`${precipText}.`);

  // з’єднаємо у два-три простих речення
  return bits.join(" ");
}

// ---- Публічні API: за місцем
export async function weatherSummaryByPlace(textOrPlace, lang = "uk") {
  const place = extractPlace(textOrPlace) || String(textOrPlace).trim();
  if (!place) {
    return { text: L.errorNotFound[lang.slice(0,2)] || L.errorNotFound.uk, timezone: "UTC" };
  }

  const geo = await geocodePlace(place, lang);
  if (!geo) {
    return { text: L.errorNotFound[lang.slice(0,2)] || L.errorNotFound.uk, timezone: "UTC" };
  }

  const cur = await getCurrentWeather(geo.lat, geo.lon);
  const label = geo.country ? `${geo.name}, ${geo.country}` : geo.name;

  return {
    text: makeWeatherText({
      placeLabel: label,
      t: cur.t, p: cur.p, w: cur.w, code: cur.code, lang
    }),
    timezone: cur.tz
  };
}

// ---- Публічні API: за координатами
export async function weatherSummaryByCoords(lat, lon, lang = "uk", placeLabel = "") {
  const cur = await getCurrentWeather(lat, lon);
  const text = makeWeatherText({
    placeLabel: placeLabel || "вашій локації",
    t: cur.t, p: cur.p, w: cur.w, code: cur.code, lang
  });
  return { text, timezone: cur.tz };
}