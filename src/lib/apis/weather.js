// src/lib/apis/weather.js
// Primary: wttr.in → Fallback: Open-Meteo (без ключів)

function arrow(url) { return ` <a href="${url}">↗︎</a>`; }

async function wttr(city) {
  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  const res = await fetch(url, {
    headers: { "user-agent": "senti-bot/1.0 (+cf-worker)" },
    cf: { cacheEverything: true, cacheTtl: 60 * 15 },
  });
  if (!res.ok) throw new Error(`wttr HTTP ${res.status}`);
  const data = await res.json();
  const c = data?.current_condition?.[0];
  if (!c) throw new Error("wttr: no current condition");
  const area = data?.nearest_area?.[0]?.areaName?.[0]?.value || city;
  return {
    provider: "wttr.in",
    city: area,
    tempC: Number(c.temp_C),
    feelsLikeC: Number(c.FeelsLikeC),
    windKph: Number(c.windspeedKmph),
    humidity: Number(c.humidity),
    desc: (c.weatherDesc?.[0]?.value || "").trim(),
  };
}

async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(query)}`;
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 60 * 60 } });
  if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
  const data = await res.json();
  const item = data?.results?.[0];
  if (!item) throw new Error("geocode: not found");
  return { name: item.name, lat: item.latitude, lon: item.longitude, country: item.country_code };
}

async function openMeteo(city) {
  const g = await geocode(city);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m`;
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 60 * 15 } });
  if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
  const data = await res.json();
  const c = data?.current;
  if (!c) throw new Error("open-meteo: no current");
  return {
    provider: "open-meteo",
    city: `${g.name}${g.country ? ", " + g.country : ""}`,
    tempC: Number(c.temperature_2m),
    feelsLikeC: Number(c.apparent_temperature),
    windKph: Number(c.wind_speed_10m),
    humidity: Number(c.relative_humidity_2m),
    desc: "Current weather",
  };
}

export async function weatherByCity(city = "Kyiv") {
  try { return await wttr(city); }
  catch (e) { console.warn("[weather] wttr failed, fallback:", e.message); }
  return await openMeteo(city);
}

// ── форматер, який потребує твій webhook ──
export function formatWeather(w, lang = "uk") {
  if (!w) return "";
  const map = {
    en: { now: "now", temp: "Temperature", feels: "feels like", wind: "Wind", hum: "Humidity", src: "source" },
    uk: { now: "зараз", temp: "Температура", feels: "відчувається як", wind: "Вітер", hum: "Вологість", src: "джерело" },
    ru: { now: "сейчас", temp: "Температура", feels: "ощущается как", wind: "Ветер", hum: "Влажность", src: "источник" },
    de: { now: "jetzt", temp: "Temperatur", feels: "gefühlt", wind: "Wind", hum: "Luftfeuchtigkeit", src: "Quelle" },
    fr: { now: "maintenant", temp: "Température", feels: "ressenti", wind: "Vent", hum: "Humidité", src: "source" },
  };
  const L = map[lang] || map.en;
  const srcUrl = w.provider === "wttr.in" ? "https://wttr.in/" : "https://open-meteo.com/";
  const lines = [
    `🌤️ <b>${w.city}</b> — ${L.now}`,
    w.desc ? `• ${w.desc}` : "",
    `• ${L.temp}: <b>${w.tempC}°C</b> (${L.feels} ${w.feelsLikeC}°C)`,
    `• ${L.wind}: ${w.windKph} km/h`,
    `• ${L.hum}: ${w.humidity}%`,
    `\n<i>${L.src}:</i> ${w.provider}${arrow(srcUrl)}`,
  ];
  return lines.filter(Boolean).join("\n");
}