// src/lib/apis/rates.js

function arrow(url) { return ` <a href="${url}">↗︎</a>`; }

export async function getUsdUahRate() {
  // Офіційний курс НБУ
  const res = await fetch("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json", {
    cf: { cacheEverything: true, cacheTtl: 300 }
  });
  if (!res.ok) throw new Error(`nbu HTTP ${res.status}`);
  const data = await res.json();
  const v = Number(data?.[0]?.rate);
  if (!Number.isFinite(v)) throw new Error("nbu: no rate");
  return { rate: v, source: "НБУ", url: "https://bank.gov.ua/ua/markets/exchangerates" };
}

export function formatUsdRate(r) {
  return `💸 Курс USD → UAH: <b>${r.rate.toFixed(2)}₴</b>${arrow(r.url)}`;
}
