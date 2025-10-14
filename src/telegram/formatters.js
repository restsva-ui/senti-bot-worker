// src/telegram/formatters.js
import { arrow } from "./helpers.js";

export const clip = (s = "", n = 420) => {
  const t = String(s);
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

export function formatNews(items = []) {
  const top = items.slice(0, 3);
  if (!top.length) return "";
  const body = top.map(i => `• ${clip(i.title, 160)}`).join("\n");
  return body + arrow(top[0].link);
}

export function formatRate(rateIn) {
  const val = typeof rateIn === "number" ? rateIn : (rateIn && typeof rateIn.rate === "number" ? rateIn.rate : 0);
  const s = val ? val.toFixed(2) : "—";
  const url = "https://bank.gov.ua/ua/markets/exchangerates";
  return `💵 USD/UAH: <b>${s} ₴</b>${arrow(url)}`;
}

export function formatWeatherInline(w, lang = "uk") {
  if (!w) return "";
  const L = {
    uk: { now: "зараз", feels: "відчувається", wind: "вітер", hum: "вологість" },
    ru: { now: "сейчас", feels: "ощущается", wind: "ветер", hum: "влажн." },
    en: { now: "now", feels: "feels", wind: "wind", hum: "humidity" },
  }[lang] || { now: "now", feels: "feels", wind: "wind", hum: "humidity" };

  const srcUrl = w.provider === "wttr.in" ? "https://wttr.in/" : "https://open-meteo.com/";
  const desc = w.desc ? `• ${w.desc}\n` : "";
  return (
    `🌤️ <b>${w.city}</b> — ${L.now}\n` +
    desc +
    `• ${w.tempC}°C (${L.feels} ${w.feelsLikeC}°C)\n` +
    `• ${L.wind}: ${w.windKph} km/h\n` +
    `• ${L.hum}: ${w.humidity}%\n` +
    arrow(srcUrl)
  );
}

export function formatWiki(w) {
  if (!w) return "";
  if (typeof w === "string") return clip(w, 500);
  const t = w.title ? `<b>${clip(w.title, 120)}</b>\n` : "";
  const u = w.url || w.link || "";
  const ex = clip(w.extract || w.summary || w.text || "", 500);
  return `${t}${ex}${arrow(u)}`;
}

export function formatHolidays(list = []) {
  const top = list.slice(0, 8).map(x => `• <b>${x.name}</b> — ${x.date}`);
  return top.join("\n");
}
