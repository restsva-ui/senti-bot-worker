// НБУ (офіційні) + ПриватБанк (готівкові/карта)
const NBU = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";
const PB_CASH = "https://api.privatbank.ua/p24api/pubinfo?json&exchange&coursid=5";
const PB_CARD = "https://api.privatbank.ua/p24api/pubinfo?json&exchange&coursid=11";

export async function nbuRates() {
  const r = await fetch(NBU, { cf: { cacheEverything: true, cacheTtl: 900 }});
  if (!r.ok) throw new Error("nbu fail");
  return await r.json(); // [{cc:'USD',rate:...},...]
}
export async function privatRates(kind = "cash") {
  const url = kind === "card" ? PB_CARD : PB_CASH;
  const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 }});
  if (!r.ok) throw new Error("privat fail");
  return await r.json(); // [{ccy:'USD',buy:'',sale:''},...]
}
export function formatNbuLine(cc, list) {
  const x = list.find(v => v.cc?.toUpperCase() === cc.toUpperCase());
  return x ? `${cc}: ${(+x.rate).toFixed(2)} грн (НБУ)` : `${cc}: немає даних`;
}
export function formatPrivatTable(list) {
  const pick = code => list.find(x => x.ccy === code);
  const u = pick("USD"), e = pick("EUR"), p = pick("PLN");
  const f = x => x ? `${x.buy} / ${x.sale}` : "—";
  return `ПриватБанк (готівка):
USD: ${f(u)}
EUR: ${f(e)}
PLN: ${f(p)}`;
}