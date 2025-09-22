// src/lang.js — language & NER utils for Senti v4.0

// ===== KV helpers for chat language =====
const kvKey = (chatId, key) => `chat:${chatId}:${key}`;
export async function getChatLang(kv, chatId) {
  try { return await kv.get(kvKey(chatId, "lang")); } catch { return null; }
}
export async function setChatLang(kv, chatId, langCode) {
  try { await kv.put(kvKey(chatId, "lang"), langCode, { expirationTtl: 90 * 24 * 3600 }); } catch {}
}

// ===== Lightweight language detection =====
const langHints = {
  uk: /[іїєґІЇЄҐ]|(привіт|будь ласка|дякую|сьогодні|грн|долар|євро)/i,
  ru: /[ёЪЪыЫэЭ]|(привет|пожалуйста|спасибо|сегодня|руб|доллар|евро)/i,
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
  if (/[A-Za-z]/.test(t) && !/[А-Яа-яІЇЄҐЁЪЫЭ]/.test(t)) return "en";
  return "uk";
}

// ===== Persona tone =====
export function ensurePersonaTone({ name, lang, genderTone }) {
  const first = (name || "").toString().trim();
  if (first) return first;
  if (genderTone === "fem") return lang==="uk"?"подруго":lang==="ru"?"подруга":"sis";
  if (genderTone === "masc") return lang==="uk"?"друже":lang==="ru"?"друг":"bro";
  return lang==="uk"?"друже":lang==="ru"?"друг":"friend";
}

// Живе привітання — без дубляжу звертання
export function buildGreet({ name, lang, genderTone }) {
  const first = (name || "").toString().trim();
  const call = first
    ? first
    : genderTone === "fem" ? (lang==="uk"?"подруго":lang==="ru"?"подруга":"sis")
    : genderTone === "masc" ? (lang==="uk"?"друже":lang==="ru"?"друг":"bro")
    : (lang==="uk"?"друже":lang==="ru"?"друг":"friend");
  const emoji = ["😉","😊","🤝","✨","🚀"][Math.floor(Math.random()*5)];
  if (lang === "uk") return `${call}, привіт ${emoji} Я Senti. Напиши кілька слів — допоможу.`;
  if (lang === "ru") return `${call}, привет ${emoji} Я Senti. Напиши пару слов — помогу.`;
  if (lang === "de") return `${call}, hallo ${emoji} Ich bin Senti. Schreib kurz, wobei helfen.`;
  if (lang === "fr") return `${call}, salut ${emoji} Je suis Senti. Dis-moi en quelques mots.`;
  return `${call}, hi ${emoji} I'm Senti — tell me in a few words and I'll help.`;
}

// ===== Gender tone extractor =====
export function extractGenderTone(text) {
  const t = (text || "").toLowerCase();
  if (!t) return "neutral";
  if (/(подруго|сестро|sis|я\s+дівчина|я\s+женщина)/i.test(t)) return "fem";
  if (/(друже|бро|bro|я\s+хлопець|я\s+мужчина)/i.test(t)) return "masc";
  return "neutral";
}

// ===== Numbers & currency NER =====
const CURR_MAP = new Map([
  ["uah","UAH"], ["грн","UAH"], ["гривн","UAH"], ["гривня","UAH"], ["гривні","UAH"], ["₴","UAH"],
  ["usd","USD"], ["$","USD"], ["долар","USD"], ["доларів","USD"], ["доллары","USD"], ["доллар","USD"], ["бакс","USD"], ["бакси","USD"],
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

  const mAmtCompact = t.match(/(\d+(?:[.,]\d+)?)(?=\s*[€$₴]|(?:\s|$))/);
  const mAmtLoose = t.match(/(\d+(?:[.,]\d+)?)/);
  let amount = null;
  if (mAmtCompact) amount = Number(mAmtCompact[1].replace(",", "."));
  else if (mAmtLoose) amount = Number(mAmtLoose[1].replace(",", "."));
  out.amount = amount ?? 1;

  const curList = findCurrencies(t);
  let base = null, quote = null;

  const dir = t.match(/(?:в|у|to|in)\s+([A-Za-zА-Яа-яІЇЄҐёЁ€$₴]+)\b/i);
  if (dir && curList.length) {
    const qTok = dir[1].replace(/[^\p{L}€$₴]/gu, "");
    quote = normCurrencyToken(qTok);
  }

  const afterAmt = t.match(/(\d+(?:[.,]\d+)?)[\s]*([€$₴]|usd|eur|uah|грн|гривн\w*|долар\w*|доллар\w*|євро|евро)/i);
  if (afterAmt) base = normCurrencyToken(afterAmt[2]);

  if (!base && curList.length) base = curList[0];
  if (!quote && curList.length > 1) quote = curList.find(c => c !== base) || null;

  if (!base && /курс\s+(гривн|гривні|uah|грн)/i.test(t)) base = "UAH";
  if (!base && /курс\s+(долар|usd|\$)/i.test(t)) base = "USD";
  if (!base && /курс\s+(євро|eur|€)/i.test(t)) base = "EUR";

  if (base && !quote) quote = base === "UAH" ? "USD" : "UAH";

  out.baseCurrency = base || null;
  out.quoteCurrency = quote || null;
  return out;
}