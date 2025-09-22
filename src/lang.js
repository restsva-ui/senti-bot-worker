// src/lang.js — language & NER utils for Senti v4.0

// ===== KV helpers for chat language =====
const kvKey = (chatId, key) => `chat:${chatId}:${key}`;
export async function getChatLang(kv, chatId) {
  try { return await kv.get(kvKey(chatId, "lang")); } catch { return null; }
}
export async function setChatLang(kv, chatId, langCode) {
  try { await kv.put(kvKey(chatId, "lang"), langCode, { expirationTtl: 90 * 24 * 3600 }); } catch {}
}

// ===== Lightweight language detection (rule-based; fast & predictable) =====
const langHints = {
  uk: /[іїєґІЇЄҐ]|(привіт|будь ласка|будь-ласка|дякую|сьогодні|грн|долар|євро)/i,
  ru: /[ёЁъЪыЫэЭ]|(привет|пожалуйста|спасибо|сегодня|руб|доллар|евро)/i,
  de: /\b(und|oder|nicht|heute|morgen|euro|danke|bitte)\b/i,
  fr: /\b(et|ou|pas|aujourd’hui|demain|merci|s’il vous plaît|euro)\b/i,
  en: /\b(and|or|please|thanks|today|tomorrow|usd|euro|dollar)\b/i,
};
export async function detectLang(text) {
  if (!text) return "uk";
  const t = text.trim();
  if (langHints.uk.test(t)) return "uk";
  if (langHints.ru.test(t)) return "ru";
  if (langHints.de.test(t)) return "de";
  if (langHints.fr.test(t)) return "fr";
  if (langHints.en.test(t)) return "en";
  // fallback by alphabet coverage
  if (/[A-Za-z]/.test(t) && !/[А-Яа-яІЇЄҐЁЪЫЭ]/.test(t)) return "en";
  return "uk";
}

// ===== Persona tone (name + gender style) =====
export function ensurePersonaTone({ name, lang, genderTone }) {
  const nm = (name || "").toString().trim();
  const call =
    genderTone === "fem" ? (lang === "uk" ? "подруго" : lang === "ru" ? "подруга" : "sis") :
    genderTone === "masc" ? (lang === "uk" ? "друже" : lang === "ru" ? "друг" : "bro") :
    (lang === "uk" ? "друже" : lang === "ru" ? "друг" : "friend");
  if (!nm) return call;
  // personalized: "Vitaliy" etc.
  return `${nm}`;
}

// ===== Gender tone extractor =====
// тригери: "друже/подруго", "bro/sis", "бро", явні "я дівчина/хлопець"
export function extractGenderTone(text) {
  const t = (text || "").toLowerCase();
  if (!t) return "neutral";
  if (/(подруго|сестро|sis|я\s+дівчина|я\s+женщина)/i.test(t)) return "fem";
  if (/(друже|бро|bro|я\s+хлопець|я\s+мужчина)/i.test(t)) return "masc";
  return "neutral";
}

// ===== Numbers & currency NER =====
// Повертає { amount, baseCurrency, quoteCurrency }
// Розпізнає: "25$ в грн", "5 доларів у гривні", "курс євро", "1 євро в долари", тощо.
const CURR_MAP = new Map([
  ["uah","UAH"], ["грн","UAH"], ["гривн","UAH"], ["гривня","UAH"], ["гривні","UAH"], ["₴","UAH"],
  ["usd","USD"], ["$","USD"], ["долар","USD"], ["доларів","USD"], ["долары","USD"], ["доллар","USD"], ["бакс","USD"], ["бакси","USD"],
  ["eur","EUR"], ["€","EUR"], ["євро","EUR"], ["евро","EUR"],
]);
function normCurrencyToken(tok) {
  if (!tok) return null;
  const k = tok.toLowerCase();
  return CURR_MAP.get(k) || tok.toUpperCase();
}
function findCurrencies(text) {
  const res = [];
  const patterns = [
    /uah|грн|гривн\w*|₴/gi,
    /usd|\$|доллар\w*|долар\w*|бакс\w*/gi,
    /eur|€|євро|евро/gi,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) res.push(...m.map(normCurrencyToken));
  }
  return [...new Set(res)];
}

export function parseNumbersAndCurrency(text) {
  const out = { amount: null, baseCurrency: null, quoteCurrency: null };

  if (!text) return out;
  const t = text.replace(/\s+/g, " ").trim();

  // 1) amount: catch "25$", "25 $", "0.5 eur", "100,25"
  const mAmtCompact = t.match(/(\d+(?:[.,]\d+)?)(?=\s*[€$₴]|(?:\s|$))/);
  const mAmtLoose = t.match(/(\d+(?:[.,]\d+)?)/);
  let amount = null;
  if (mAmtCompact) amount = Number(mAmtCompact[1].replace(",", "."));
  else if (mAmtLoose) amount = Number(mAmtLoose[1].replace(",", "."));
  out.amount = amount ?? null;

  // 2) currencies & direction
  const curList = findCurrencies(t);
  // direct symbol after number defines base: "25$" → base USD
  let base = null, quote = null;

  // Explicit pattern: "<amt> <base> (в|у|to|in) <quote>"
  const dir = t.match(/(?:в|у|to|in)\s+([A-Za-zА-Яа-яІЇЄҐёЁ€$₴]+)\b/i);
  if (dir && curList.length) {
    // what is the 'quote' token?
    const qTok = dir[1].replace(/[^\p{L}€$₴]/gu, "");
    quote = normCurrencyToken(qTok);
  }

  // token immediately following amount may hint base (e.g., "25$" or "25 usd")
  const afterAmt = t.match(/(\d+(?:[.,]\d+)?)[\s]*([€$₴]|usd|eur|uah|грн|гривн\w*|долар\w*|доллар\w*|євро|евро)/i);
  if (afterAmt) {
    base = normCurrencyToken(afterAmt[2]);
  }

  // if still unknown, pick from detected list
  if (!base && curList.length) base = curList[0];
  if (!quote && curList.length > 1) {
    // choose a currency different from base as quote
    quote = curList.find(c => c !== base) || null;
  }

  // Defaults & special phrases "курс гривні", etc.
  if (!base && /курс\s+(гривн|гривні|uah|грн)/i.test(t)) base = "UAH";
  if (!base && /курс\s+(долар|usd|\$)/i.test(t)) base = "USD";
  if (!base && /курс\s+(євро|eur|€)/i.test(t)) base = "EUR";

  // If only one side known → use other as default (UAH by defaultFiat in FX; here choose UAH as common target)
  if (base && !quote) quote = base === "UAH" ? "USD" : "UAH";

  // Normalize result
  out.baseCurrency = base || null;
  out.quoteCurrency = quote || null;

  // Amount fallback
  if (out.amount == null) out.amount = 1;

  return out;
}
