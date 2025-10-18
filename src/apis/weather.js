// src/apis/weather.js
// Безкоштовна погода через Open-Meteo (жодних ключів)

const WMO = {
  0: "clear", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "rime fog", 51: "light drizzle", 53: "drizzle", 55: "dense drizzle",
  56: "freezing drizzle", 57: "freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain",
  66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow",
  77: "snow grains",
  80: "light showers", 81: "showers", 82: "violent showers",
  85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm w/ hail", 99: "thunderstorm w/ heavy hail"
};

function wmoText(code = 0, lang = "en") {
  const en = WMO[code] || "weather";
  // Дуже простий переклад ключових станів (досить для короткого резюме)
  const map = {
    uk: {
      "clear":"ясно","mainly clear":"переважно ясно","partly cloudy":"мінлива хмарність","overcast":"хмарно",
      "fog":"туман","rime fog":"паморозь","light drizzle":"слабка мжичка","drizzle":"мжичка","dense drizzle":"сильна мжичка",
      "freezing drizzle":"крижанa мжичка","light rain":"слабкий дощ","rain":"дощ","heavy rain":"сильний дощ",
      "freezing rain":"крижаний дощ","light snow":"слабкий сніг","snow":"сніг","heavy snow":"сильний сніг",
      "snow grains":"снігові зерна","light showers":"короткочасні опади","showers":"зливи","violent showers":"сильні зливи",
      "snow showers":"снігові зливи","heavy snow showers":"сильні снігові зливи",
      "thunderstorm":"гроза","thunderstorm w/ hail":"гроза з градом","thunderstorm w/ heavy hail":"гроза з сильним градом",
      "weather":"погода"
    },
    ru: {
      "clear":"ясно","mainly clear":"в основном ясно","partly cloudy":"переменная облачность","overcast":"пасмурно",
      "fog":"туман","rime fog":"изморозь","light drizzle":"слабкая морось","drizzle":"морось","dense drizzle":"сильная морось",
      "freezing drizzle":"ледяная морось","light rain":"небольшой дождь","rain":"дождь","heavy rain":"сильный дождь",
      "freezing rain":"ледяной дождь","light snow":"небольшой снег","snow":"снег","heavy snow":"сильный снег",
      "snow grains":"снежная крупа","light showers":"кратковременные осадки","showers":"ливни","violent showers":"сильные ливни",
      "snow showers":"снежные заряды","heavy snow showers":"сильные снежные заряды",
      "thunderstorm":"гроза","thunderstorm w/ hail":"гроза с градом","thunderstorm w/ heavy hail":"гроза с сильным градом",
      "weather":"погода"
    },
    fr: { "clear":"dégagé","partly cloudy":"nuageux","overcast":"couvert","rain":"pluie","snow":"neige","thunderstorm":"orage","weather":"météo" },
    de: { "clear":"heiter","partly cloudy":"wolkig","overcast":"bedeckt","rain":"Regen","snow":"Schnee","thunderstorm":"Gewitter","weather":"Wetter" }
  };
  return (map[lang]?.[en]) || en;
}

function emojiFor(code = 0, isDay = 1) {
  if ([61,63,65,80,81,82].includes(code)) return "🌧️";
  if ([71,73,75,85,86,77].includes(code)) return "❄️";
  if ([45,48].includes(code)) return "🌫️";
  if ([95,96,99].includes(code)) return "⛈️";
  if ([2,3].includes(code)) return "⛅";
  return isDay ? "☀️" : "🌙";
}

export async function geocodePlace(q, lang = "en") {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1&language=${lang}&format=json`;
  const r = await fetch(url);
  const j = await r.json().catch(() => null);
  const p = j?.results?.[0];
  if (!p) return null;
  return { name: p.name, country: p.country_code || p.country, lat: p.latitude, lon: p.longitude, tz: p.timezone };
}

export async function getCurrentWeather({ lat, lon, tz = "auto" }) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m`
    + `&timezone=${encodeURIComponent(tz)}`;
  const r = await fetch(url);
  const j = await r.json().catch(() => null);
  const c = j?.current;
  if (!c) return null;
  return {
    temp: c.temperature_2m,
    feels: c.apparent_temperature,
    isDay: c.is_day,
    code: c.weather_code,
    wind: c.wind_speed_10m
  };
}

export function formatWeatherSummary({ place, current, lang = "en" }) {
  const e = emojiFor(current.code, current.isDay);
  const cond = wmoText(current.code, lang);
  const t = Math.round(current.temp);
  const f = Math.round(current.feels);
  const w = Math.round(current.wind);
  if (lang === "uk") return `${e} У ${place} зараз ${t}°C (відчувається як ${f}°C), ${cond}. Вітер ${w} м/с.`;
  if (lang === "ru") return `${e} В ${place} сейчас ${t}°C (ощущается как ${f}°C), ${cond}. Ветер ${w} м/с.`;
  if (lang === "fr") return `${e} À ${place} il fait ${t}°C (ressenti ${f}°C), ${cond}. Vent ${w} m/s.`;
  if (lang === "de") return `${e} In ${place} jetzt ${t}°C (gefühlt ${f}°C), ${cond}. Wind ${w} m/s.`;
  return `${e} In ${place} it's ${t}°C (feels ${f}°C), ${cond}. Wind ${w} m/s.`;
}

// Проста детекція наміру та парсинг міста
export function weatherIntent(text = "") {
  const s = String(text).trim();
  const m1 = s.match(/^\/weather\s+(.+)/i);
  if (m1) return { place: m1[1].trim() };
  const m2 = s.match(/\b(?:weather|погода|meteo)\s+(?:in|у|в)\s+([A-Za-zÀ-ÿĀ-žЁёА-Яа-яЇїІіЄєҐґ\-\s]{2,})/i);
  if (m2) return { place: m2[1].trim() };
  const m3 = s.match(/^(?:погода|weather)\??$/i);
  if (m3) return { place: null }; // попросимо місцезнаходження або місто
  return null;
}

export async function weatherSummaryByPlace(query, lang = "en") {
  const g = await geocodePlace(query, lang);
  if (!g) return null;
  const cur = await getCurrentWeather({ lat: g.lat, lon: g.lon, tz: g.tz || "auto" });
  if (!cur) return null;
  const place = [g.name, g.country].filter(Boolean).join(", ");
  return formatWeatherSummary({ place, current: cur, lang });
}

export async function weatherSummaryByCoords({ lat, lon, label = "your location", lang = "en", tz = "auto" }) {
  const cur = await getCurrentWeather({ lat, lon, tz });
  if (!cur) return null;
  return formatWeatherSummary({ place: label, current: cur, lang });
}