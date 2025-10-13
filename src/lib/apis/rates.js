// src/lib/apis/rates.js
// Exchange rate USD→UAH via NBU primary + exchangerate.host fallback.

async function nbuRate() {
  const url = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 60 * 30 } }); // 30 min
  if (!res.ok) throw new Error(`NBU HTTP ${res.status}`);
  const data = await res.json();
  const usd = Array.isArray(data) ? data.find(x => x?.cc === "USD") : null;
  if (!usd?.rate) throw new Error("NBU: USD not found");
  return Number(usd.rate);
}

async function erHost(base = "USD", symbol = "UAH") {
  const url = `https://api.exchangerate.host/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 60 * 30 } });
  if (!res.ok) throw new Error(`ERHost HTTP ${res.status}`);
  const data = await res.json();
  const v = data?.rates?.[symbol];
  if (typeof v !== "number") throw new Error("ERHost: no rate");
  return Number(v);
}

export async function getUsdUahRate() {
  try {
    return await nbuRate();
  } catch (e) {
    console.warn("[rates] NBU failed, fallback ERHost:", e.message);
    return await erHost("USD", "UAH");
  }
}

export function formatUsdRate(rate) {
  if (!rate) return "Не вдалося отримати курс 😕";
  return `💵 Курс USD → UAH: <b>${rate.toFixed(2)}₴</b>\n<i>джерело: НБУ або exchangerate.host</i>`;
}