export async function weatherByCity(city = "Kyiv") {
  const api = "https://wttr.in/" + encodeURIComponent(city) + "?format=j1";
  const r = await fetch(api);
  const j = await r.json().catch(() => null);
  if (!j?.current_condition?.[0]) throw new Error("Weather data unavailable");
  const cur = j.current_condition[0];
  return {
    city,
    temp: cur.temp_C,
    desc: cur.weatherDesc?.[0]?.value || "",
    humidity: cur.humidity,
  };
}

export function formatWeather(data) {
  if (!data) return "❌ Немає даних про погоду.";
  return `🌤️ Погода у ${data.city}:\nТемпература: ${data.temp}°C\nВологість: ${data.humidity}%\n${data.desc}`;
}