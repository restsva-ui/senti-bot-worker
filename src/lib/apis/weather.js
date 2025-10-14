// src/lib/apis/weather.js
function arrow(url){ return ` <a href="${url}">↗︎</a>`; }

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

  return {
    provider: "wttr.in",
    city: data?.nearest_area?.[0]?.areaName?.[0]?.value || city,
    desc: c?.weatherDesc?.[0]?.value || "",
    tempC: Number(c?.temp_C),
    feelsLikeC: Number(c?.FeelsLikeC),
    windKph: Number(c?.windspeedKmph),
    humidity: Number(c?.humidity),
  };
}

async function openMeteo(city) {
  // 1) геокод
  const gq = new URL("https://geocoding-api.open-meteo.com/v1/search");
  gq.searchParams.set("name", city); gq.searchParams.set("count", "1");
  gq.searchParams.set("language", "uk"); gq.searchParams.set("format", "json");
  const g = await fetch(gq, { cf: { cacheEverything: true, cacheTtl: 60 * 60 } });
  if (!g.ok) throw new Error(`geocode HTTP ${g.status}`);
  const gj = await g.json();
  const p = gj?.results?.[0];
  if (!p) throw new Error("geocode: no results");

  // 2) погода
  const wq = new URL("https://api.open-meteo.com/v1/forecast");
  wq.searchParams.set("latitude", String(p.latitude));
  wq.searchParams.set("longitude", String(p.longitude));
  wq.searchParams.set("current_weather", "true");
  const w = await fetch(wq, { cf: { cacheEverything: true, cacheTtl: 60 * 10 } });
  if (!w.ok) throw new Error(`open-meteo HTTP ${w.status}`);
  const wj = await w.json();
  const c = wj?.current_weather;
  if (!c) throw new Error("open-meteo: no current");

  return {
    provider: "open-meteo",
    city: p.name,
    desc: "",
    tempC: Number(c.temperature),
    feelsLikeC: Number(c.temperature), // у open-meteo немає feels-like у current_weather
    windKph: Number(c.windspeed),
    humidity: Number.isFinite(wj?.hourly?.relativehumidity_2m?.[0]) ? Number(wj.hourly.relativehumidity_2m[0]) : 0,
  };
}

export async function weatherByCity(city) {
  try { return await wttr(city); }
  catch { return await openMeteo(city); }
}

export function formatWeather(w, lang = "uk") {
  const map = {
    uk: { now: "зараз", temp: "Температура", feels: "відчувається", wind: "Вітер", hum: "Вологість", src: "джерело" },
    ru: { now: "сейчас", temp: "Температура", feels: "ощущается", wind: "Ветер", hum: "Влажность", src: "источник" },
    en: { now: "now", temp: "Temperature", feels: "feels like", wind: "Wind", hum: "Humidity", src: "source" },
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
