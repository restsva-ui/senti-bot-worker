// Open-Meteo: погода + їх же геокодер (без ключів)
const ORIGIN = "https://api.open-meteo.com/v1/forecast";
const GEO = "https://geocoding-api.open-meteo.com/v1/search";

export async function geocodeCity(name, lang = "uk", count = 5) {
  const url = `${GEO}?name=${encodeURIComponent(name)}&language=${lang}&count=${count}`;
  const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 3600 }});
  if (!r.ok) throw new Error("geocode failed");
  const j = await r.json();
  return (j.results || []).map(x => ({
    name: x.name, country: x.country, lat: x.latitude, lon: x.longitude
  }));
}

export async function getWeather({ lat, lon, tz = "auto", lang = "uk" }) {
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    hourly: "temperature_2m,precipitation,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    current_weather: "true",
    timezone: tz, language: lang
  });
  const url = `${ORIGIN}?${params}`;
  const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 }});
  if (!r.ok) throw new Error("weather failed");
  return await r.json();
}

export function formatWeatherShort(j) {
  const c = j?.current_weather;
  if (!c) return "Погода недоступна.";
  const d0 = j?.daily;
  const hi = d0?.temperature_2m_max?.[0];
  const lo = d0?.temperature_2m_min?.[0];
  return `Зараз: ${Math.round(c.temperature)}°C, вітер ${Math.round(c.windspeed)} м/с.
Доба: max ${Math.round(hi)}° / min ${Math.round(lo)}°`;
}