// src/apis/weather.js
// Open-Meteo + Nominatim: без ключів, з локальною таймзоною міста

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast";

// простий геокодер міста → { name, lat, lon, country }
export async function geocodeCity(city, lang = "uk") {
  const url = `${NOMINATIM}?format=json&q=${encodeURIComponent(city)}&addressdetails=1&limit=1&accept-language=${lang}&namedetails=1`;
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

// код → текст (мінімальний набір достатній для коротких відповідей)
const WMO = {
  0: "ясно",
  1: "переважно ясно",
  2: "мінлива хмарність",
  3: "хмарно",
  45: "туман",
  48: "паморозь",
  51: "морось слабка",
  53: "морось",
  55: "морось сильна",
  61: "дощ слабкий",
  63: "дощ",
  65: "дощ сильний",
  71: "сніг слабкий",
  73: "сніг",
  75: "сніг сильний",
  80: "зливи слабкі",
  81: "зливи",
  82: "зливи сильні",
  95: "гроза"
};

export async function weatherSummaryByLatLon(lat, lon, lang = "uk") {
  const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,weather_code,wind_speed_10m,precipitation`
    + `&hourly=temperature_2m,precipitation_probability`
    + `&timezone=auto`; // головне — локальний час локації

  const r = await fetch(url);
  if (!r.ok) throw new Error(`weather http ${r.status}`);
  const data = await r.json();

  const tz = data?.timezone || "UTC";
  const cur = data?.current || {};
  const t = typeof cur.temperature_2m === "number" ? Math.round(cur.temperature_2m) : null;
  const wind = cur.wind_speed_10m;
  const code = cur.weather_code;
  const precip = cur.precipitation;

  const desc = (code in WMO) ? WMO[code] : "погода";
  const parts = [];
  if (t !== null) parts.push(`${t}°C`);
  parts.push(desc);
  if (typeof wind === "number") parts.push(`вітер ${Math.round(wind)} м/с`);
  if (typeof precip === "number" && precip > 0) parts.push(`опади ${precip} мм`);

  const text = parts.filter(Boolean).join(", ");
  return { text, timezone: tz };
}

// зручна обгортка: місто → короткий рядок + tz
export async function weatherByCity(city, lang = "uk") {
  const geo = await geocodeCity(city, lang);
  if (!geo) return null;
  const w = await weatherSummaryByLatLon(geo.lat, geo.lon, lang);
  return { city: geo.name, country: geo.country, ...w };
}