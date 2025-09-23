// src/fx.js — Senti FX v4.1.3 (ESM, stable)

const AUTO_TTL = 12 * 3600; // 12h
const NBU_TTL  = 30 * 60;   // 30m

const ISO3 = new Set([
  "USD","EUR","UAH","GBP","PLN","CHF","CAD","AUD","JPY","CNY","TRY","CZK","SEK","NOK","DKK","HUF","RON","BGN",
]);

const UA_WORDS = /грн|гривн|гривня|гривні|₴/i;
const USD_WORDS = /usd|\$|долар|доллар|бакс/i;
const EUR_WORDS = /eur|€|євро|евро/i;

function fmt(n) { return Number(n).toLocaleString("en-US", { maximumSignificantDigits: 6 }); }

function pickIso(token, fallback=null) {
  if (!token) return fallback;
  const t = token.toUpperCase();
  if (ISO3.has(t)) return t;
  if (UA_WORDS.test(token)) return "UAH";
  if (USD_WORDS.test(token)) return "USD";
  if (EUR_WORDS.test(token)) return "EUR";
  return fallback;
}

async function fetchAutoRate(base, quote) {
  // 1) exchangerate.host
  try {
    const u1 = `https://api.exchangerate.host/latest?base=${base}&symbols=${quote}`;
    const r1 = await fetch(u1, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r1.ok) {
      const j = await r1.json();
      const v = j?.rates?.[quote];
      if (v && isFinite(v)) return v;
    }
  } catch {}
  // 2) open.er-api.com
  try {
    const u2 = `https://open.er-api.com/v6/latest/${base}`;
    const r2 = await fetch(u2, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r2.ok) {
      const j = await r2.json();
      const v = j?.rates?.[quote];
      if (v && isFinite(v)) return v;
    }
  } catch {}
  return null;
}

async function fetchNbuRate(base, quote) {
  // NBU завжди дає курс до UAH
  let rate = null;
  if (base !== "UAH" && quote === "UAH") {
    const u = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${base}&json`;
    const r = await fetch(u, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) { const j = await r.json(); rate = j?.[0]?.rate || null; }
  } else if (base === "UAH" && quote !== "UAH") {
    const u = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${quote}&json`;
    const r = await fetch(u, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r.ok) { const j = await r.json(); const q = j?.[0]?.rate; rate = q ? 1 / q : null; }
  } else if (base !== "UAH" && quote !== "UAH") {
    const b = await fetchNbuRate(base, "UAH");
    const q = await fetchNbuRate(quote, "UAH");
    if (b && q) rate = b / q;
  } else {
    rate = 1;
  }
  return rate;
}

function wantsNBUFlag(text) {
  return /(?:\bNBU\b|\bНБУ\b|\bnbu\b|\bнбу\b)/i.test(text || "");
}

async function getCached(env, key) {
  try { return await env.AIMAGIC_SESS.get(key, "json"); } catch { return null; }
}
async function putCached(env, key, val, ttl) {
  try { await env.AIMAGIC_SESS.put(key, JSON.stringify(val), { expirationTtl: ttl }); } catch {}
}

/**
 * getFX(env, { text, parsed, defaultFiat, replyLang })
 * - text: початковий запит (для визначення NBU)
 * - parsed: { amount, base, quote } — опціонально; якщо немає, будуть підказки з тексту
 * - defaultFiat: "UAH"/"USD"/"EUR" — дефолт котирування
 * - replyLang: "uk"/"ru"/"en"/...
 * return: { text, base, quote, rate, source }
 */
export async function getFX(env, { text = "", parsed = {}, defaultFiat = "UAH", replyLang = "uk" } = {}) {
  const useNBU = wantsNBUFlag(text);

  // amount / base / quote
  const amt = Number(parsed?.amount) > 0 ? Number(parsed.amount) : 1;

  // Вирахуємо базову валюту: з parsed, або з ключових слів
  let base = pickIso(parsed?.base, null);
  if (!base) {
    if (UA_WORDS.test(text)) base = "UAH";
    else if (USD_WORDS.test(text)) base = "USD";
    else if (EUR_WORDS.test(text)) base = "EUR";
    else base = "UAH";
  }

  // Котирування: parsed.quote або дефолт користувача (інакше UAH/USD)
  let quote = pickIso(parsed?.quote, null);
  if (!quote) quote = defaultFiat || (base === "UAH" ? "USD" : "UAH");

  // Заборона base==quote
  if (base === quote) quote = base === "UAH" ? "USD" : "UAH";

  // Кеш-ключ
  const cacheKey = `${useNBU ? "fx:nbu" : "fx:auto"}:${base}->${quote}`;
  let rate = await getCached(env, cacheKey);
  if (!rate) {
    rate = useNBU ? await fetchNbuRate(base, quote) : await fetchAutoRate(base, quote);
    if (rate) await putCached(env, cacheKey, rate, useNBU ? NBU_TTL : AUTO_TTL);
  }

  // Якщо все одно нема курсу
  if (!rate) {
    const fail = replyLang === "uk" ? "Сталась помилка з курсом." :
                 replyLang === "ru" ? "Произошла ошибка с курсом." :
                 "FX error.";
    return { text: fail, base, quote, rate: null, source: useNBU ? "NBU" : "AUTO" };
  }

  const tag = useNBU ? (replyLang === "uk" || replyLang === "ru" ? "(НБУ)" : "(NBU)") : "";
  const line = amt !== 1
    ? `${amt} ${base} ≈ ${fmt(amt * rate)} ${quote}${tag ? " " + tag : ""}`
    : `1 ${base} ≈ ${fmt(rate)} ${quote}${tag ? " " + tag : ""}`;

  // На випадок старих форматерів — чистимо “(ER)”, якщо прилетить із зовнішніх шарів
  const textOut = line.replace(/\s*\(ER\)/g, "");

  return { text: textOut, base, quote, rate, source: useNBU ? "NBU" : "AUTO" };
}

export default { getFX };
