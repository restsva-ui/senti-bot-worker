// src/fx.js — Fiat FX for Senti v4.0
// AUTO: exchangerate.host → fallback open.er-api
// NBU: official rate (trigger: "НБУ"/"nbu")
// Cache: AUTO 12h, NBU 30m
//
// Exports: handleFX(env, { text, parsed, defaultFiat, replyLang })

const AUTO_TTL = 12 * 3600;      // 12h
const NBU_TTL  = 30 * 60;        // 30m

const ISO = {
  UAH: "UAH", USD: "USD", EUR: "EUR",
  уах: "UAH", грн: "UAH", гривня: "UAH", гривні: "UAH", гривень: "UAH",
  доллар: "USD", долар: "USD", usd: "USD", "$": "USD", бакс: "USD", бакси: "USD",
  євро: "EUR", евро: "EUR", eur: "EUR", "€": "EUR",
};

function i18n(replyLang) {
  const L = {
    uk: {
      approx: "≈",
      nbuTag: "(НБУ)",
      invalid: "Не вдалося отримати курс.",
      fmtPair: (a, aIso, b, bIso, rate, tag) => `${a} ${aIso} ${L.uk.approx} ${fmtNum(a * rate)} ${bIso}${tag ? " " + tag : ""}`,
      rateLine: (base, quote, rate, tag) => `1 ${base} ${L.uk.approx} ${fmtNum(rate)} ${quote}${tag ? " " + tag : ""}`,
    },
    ru: {
      approx: "≈",
      nbuTag: "(НБУ)",
      invalid: "Не удалось получить курс.",
      fmtPair: (a, aIso, b, bIso, rate, tag) => `${a} ${aIso} ${L.ru.approx} ${fmtNum(a * rate)} ${bIso}${tag ? " " + tag : ""}`,
      rateLine: (base, quote, rate, tag) => `1 ${base} ${L.ru.approx} ${fmtNum(rate)} ${quote}${tag ? " " + tag : ""}`,
    },
    de: {
      approx: "≈",
      nbuTag: "(NBU)",
      invalid: "Kurs konnte nicht abgerufen werden.",
      fmtPair: (a, aIso, b, bIso, rate, tag) => `${a} ${aIso} ${L.de.approx} ${fmtNum(a * rate)} ${bIso}${tag ? " " + tag : ""}`,
      rateLine: (base, quote, rate, tag) => `1 ${base} ${L.de.approx} ${fmtNum(rate)} ${quote}${tag ? " " + tag : ""}`,
    },
    fr: {
      approx: "≈",
      nbuTag: "(NBU)",
      invalid: "Impossible d’obtenir le taux.",
      fmtPair: (a, aIso, b, bIso, rate, tag) => `${a} ${aIso} ${L.fr.approx} ${fmtNum(a * rate)} ${bIso}${tag ? " " + tag : ""}`,
      rateLine: (base, quote, rate, tag) => `1 ${base} ${L.fr.approx} ${fmtNum(rate)} ${quote}${tag ? " " + tag : ""}`,
    },
    en: {
      approx: "≈",
      nbuTag: "(NBU)",
      invalid: "Failed to fetch rate.",
      fmtPair: (a, aIso, b, bIso, rate, tag) => `${a} ${aIso} ${L.en.approx} ${fmtNum(a * rate)} ${bIso}${tag ? " " + tag : ""}`,
      rateLine: (base, quote, rate, tag) => `1 ${base} ${L.en.approx} ${fmtNum(rate)} ${quote}${tag ? " " + tag : ""}`,
    },
  };
  return L[replyLang] || L.en;
}

function normISO(s) {
  if (!s) return null;
  const k = s.toString().trim().toLowerCase();
  return ISO[k] || s.toUpperCase();
}

function fmtNum(n) {
  if (!isFinite(n)) return String(n);
  // Show up to 6 significant digits, remove trailing zeros
  const s = Number(n).toLocaleString("en-US", { maximumSignificantDigits: 6 });
  return s;
}

// Fallback parsing in case parsed is light
function naiveParse(text) {
  const res = { amount: 1, base: null, quote: null };
  if (!text) return res;

  // amount like "25$" or "25 $" or "0.5 btc"
  const mAmt = text.match(/(\d+(?:[.,]\d+)?)(?=\s*[^\d\s]|(?:\s|$))/);
  if (mAmt) res.amount = Number(mAmt[1].replace(",", "."));

  // detect currencies
  const hasUAH = /(uah|грн|гривн|гривня|гривні|₴)/i.test(text);
  const hasUSD = /(usd|\$|долар|доларів|доллар|бакс)/i.test(text);
  const hasEUR = /(eur|€|євро|евро)/i.test(text);

  if (hasUSD && hasUAH) {
    // phrase may imply conversion; detect direction by "в/у"
    const toUAH = /\b(в|у)\s*(грн|uah)/i.test(text);
    res.base = toUAH ? "USD" : "UAH";
    res.quote = toUAH ? "UAH" : "USD";
  } else if (hasEUR && hasUAH) {
    const toUAH = /\b(в|у)\s*(грн|uah)/i.test(text);
    res.base = toUAH ? "EUR" : "UAH";
    res.quote = toUAH ? "UAH" : "EUR";
  } else if (hasUSD) {
    res.base = "USD";
    res.quote = "UAH";
  } else if (hasEUR) {
    res.base = "EUR";
    res.quote = "UAH";
  } else if (hasUAH) {
    // "курс гривні" → show vs defaultFiat (handled later)
    res.base = "UAH";
  }
  return res;
}

async function fetchAutoRate(base, quote) {
  // exchangerate.host
  const url1 = `https://api.exchangerate.host/latest?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`;
  try {
    const r1 = await fetch(url1, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r1.ok) {
      const j = await r1.json();
      const rate = j?.rates?.[quote];
      if (rate) return rate;
    }
  } catch {}
  // fallback: open.er-api
  const url2 = `https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`;
  try {
    const r2 = await fetch(url2, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (r2.ok) {
      const j = await r2.json();
      const rate = j?.rates?.[quote];
      if (rate) return rate;
    }
  } catch {}
  return null;
}

async function fetchNbuRate(base, quote) {
  // NBU returns UAH per foreign currency. If base === USD and quote === UAH, use one call.
  // If base === UAH and quote === USD -> invert.
  const mapToNBU = (c) => c.toUpperCase(); // USD, EUR, etc.
  const isUAHperX = (b, q) => b !== "UAH" && q === "UAH";
  const isXperUAH = (b, q) => b === "UAH" && q !== "UAH";

  let rate = null;

  if (isUAHperX(base, quote)) {
    const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${mapToNBU(base)}&json`;
    const r = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } }).catch(() => null);
    if (r && r.ok) {
      const j = await r.json().catch(() => null);
      const v = Array.isArray(j) && j[0]?.rate;
      if (v) rate = Number(v); // UAH per base
    }
  } else if (isXperUAH(base, quote)) {
    // Need inverse of (UAH per quote)
    const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${mapToNBU(quote)}&json`;
    const r = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } }).catch(() => null);
    if (r && r.ok) {
      const j = await r.json().catch(() => null);
      const v = Array.isArray(j) && j[0]?.rate;
      if (v) rate = 1 / Number(v); // quote per 1 UAH
    }
  } else if (base !== "UAH" && quote !== "UAH") {
    // Cross via UAH (nbu has only vs UAH)
    const uBase = await fetchNbuRate(base, "UAH");
    const uQuote = await fetchNbuRate(quote, "UAH");
    if (uBase && uQuote) rate = uBase / uQuote;
  } else {
    // base===quote
    rate = 1;
  }

  return rate;
}

async function getCached(env, key) {
  try { return await env.AIMAGIC_SESS.get(key, "json"); } catch { return null; }
}
async function setCached(env, key, value, ttl) {
  try { await env.AIMAGIC_SESS.put(key, JSON.stringify(value), { expirationTtl: ttl }); } catch {}
}

function pickCurrencies(parsed, text, defaultFiat) {
  const p = parsed || {};
  let amount = Number(p.amount) || null;
  let base = normISO(p.baseCurrency || p.base);
  let quote = normISO(p.quoteCurrency || p.quote);
  if (!amount) {
    const np = naiveParse(text || "");
    amount = np.amount || 1;
    base = base || np.base;
    quote = quote || np.quote;
  }
  // Defaults: if only one specified
  if (base && !quote) quote = defaultFiat || "UAH";
  if (!base && quote) base = "UAH";
  if (!base && !quote) {
    // “курс гривні” → 1 UAH to defaultFiat
    base = "UAH";
    quote = defaultFiat || "USD";
  }
  if (base === quote) quote = base === "UAH" ? "USD" : "UAH";
  return { amount: amount || 1, base, quote };
}

export async function handleFX(env, { text, parsed, defaultFiat, replyLang }) {
  const L = i18n(replyLang);
  const wantsNBU = /(?:\bNBU\b|\bНБУ\b|\bnbu\b|\bнбу\b)/i.test(text || "");

  const { amount, base, quote } = pickCurrencies(parsed, text, defaultFiat);

  if (!base || !quote) {
    return { text: L.invalid };
  }

  const k = wantsNBU
    ? `fx:nbu:${base}->${quote}`
    : `fx:auto:${base}->${quote}`;

  let rate = await getCached(env, k);
  if (!rate) {
    rate = wantsNBU ? await fetchNbuRate(base, quote) : await fetchAutoRate(base, quote);
    if (rate) {
      await setCached(env, k, rate, wantsNBU ? NBU_TTL : AUTO_TTL);
    }
  }

  if (!rate) return { text: L.invalid };

  // Build response
  const tag = wantsNBU ? (replyLang === "uk" || replyLang === "ru" ? L.nbuTag : "(NBU)") : "";
  const out = amount && Math.abs(amount - 1) > 1e-9
    ? L.fmtPair(amount, base, null, quote, rate, tag)
    : L.rateLine(base, quote, rate, tag);

  return { text: out };
}
