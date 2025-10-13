export async function getUsdUahRate() {
  const r = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=UAH");
  const j = await r.json().catch(() => null);
  if (!j?.rates?.UAH) throw new Error("Rate unavailable");
  return j.rates.UAH;
}

export function formatRate(rate) {
  if (!rate) return "❌ Немає даних про курс долара.";
  return `💵 Поточний курс USD → UAH: ${rate.toFixed(2)}₴`;
}