// index.js — Senti v4.1 (MONOLITH) — все в одному файлі
// Cloudflare Workers
//
// REQS in wrangler.toml:
// name = "senti-bot-worker"
// main = "index.js"
// [[kv_namespaces]] binding = "AIMAGIC_SESS" ; id = "2cbb2a8da8d547358d577524cf3eb70a"
// [ai] binding = "AI"
// [vars] WEBHOOK_SECRET="senti1984", DEFAULT_FIAT="UAH"
// Secrets: TELEGRAM_TOKEN
//
// Функціонал: /start + живе привітання; FX (AUTO/НБУ, без "(ER)"),
// crypto (Coingecko), calendar (офіц.+неофіц.), gifts (простий генератор),
// media (дружні відповіді/хінт), NER/мова/гендер, KV-пам’ять валюти/мови.

/////////////////////////////
// Telegram helpers
async function tgSendChatAction(env, chat_id, action = "typing") {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendChatAction`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, action }),
  }).catch(() => {});
}

async function tgSendMessage(env, chat_id, text, opts = {}) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
  const body = { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...opts };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok ? res.json() : null;
}

// Хінт для фото без підпису
async function tgReplyMediaHint(env, chat_id, langCode) {
  const hint =
    langCode === "uk"
      ? "Надішли фото без підпису — можу описати, покращити, стилізувати або прибрати/замінити фон."
      : langCode === "ru"
      ? "Пришли фото без подписи — опишу, улучшу, стилизую или уберу/заменю фон."
      : langCode === "de"
      ? "Sende ein Foto ohne Text – ich kann beschreiben, verbessern, stylen oder den Hintergrund entfernen/ersetzen."
      : langCode === "fr"
      ? "Envoie une photo sans texte – je peux décrire, améliorer, styliser ou remplacer le fond."
      : "Send a photo without caption — I can describe, enhance, stylize, or remove/replace the background.";
  await tgSendMessage(env, chat_id, hint);
}

/////////////////////////////
// KV helpers
const kvKey = (chatId, key) => `chat:${chatId}:${key}`;

async function getDefaultFiat(env, chatId) {
  const v = await env.AIMAGIC_SESS.get(kvKey(chatId, "default_fiat"));
  if (v) return v;
  return env.DEFAULT_FIAT || "UAH";
}
async function setDefaultFiat(env, chatId, code) {
  await env.AIMAGIC_SESS.put(kvKey(chatId, "default_fiat"), code, { expirationTtl: 90 * 24 * 3600 });
}
async function getChatLangKV(env, chatId) {
  try { return await env.AIMAGIC_SESS.get(kvKey(chatId, "lang")); } catch { return null; }
}
async function setChatLangKV(env, chatId, lang) {
  try { await env.AIMAGIC_SESS.put(kvKey(chatId, "lang"), lang, { expirationTtl: 90 * 24 * 3600 }); } catch {}
}

/////////////////////////////
// Language & NER
const langHints = {
  uk: /[іїєґІЇЄҐ]|(привіт|будь ласка|дякую|сьогодні|грн|долар|євро)/i,
  ru: /[ёЁъЪыЫэЭ]|(привет|пожалуйста|спасибо|сегодня|руб|доллар|евро)/i,
  de: /\b(und|oder|nicht|heute|morgen|euro|danke|bitte)\b/i,
  fr: /\b(et|ou|pas|aujourd’hui|demain|merci|s’il vous plaît|euro)\b/i,
  en: /\b(and|or|please|thanks|today|tomorrow|usd|euro|dollar)\b/i,
};
async function detectLang(text) {
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
function ensurePersonaTone({ name, lang, genderTone }) {
  const first = (name || "").toString().trim();
  if (first) return first;
  if (genderTone === "fem") return lang==="uk"?"подруго":lang==="ru"?"подруга":"sis";
  if (genderTone === "masc") return lang==="uk"?"друже":lang==="ru"?"друг":"bro";
  return lang==="uk"?"друже":lang==="ru"?"друг":"friend";
}
function extractGenderTone(text) {
  const t = (text || "").toLowerCase();
  if (!t) return "neutral";
  if (/(подруго|сестро|sis|я\s+дівчина|я\s+женщина)/i.test(t)) return "fem";
  if (/(друже|бро|bro|я\s+хлопець|я\s+мужчина)/i.test(t)) return "masc";
  return "neutral";
}
// Привітання
const greetingsFirst = {
  uk: [
    "Привіт, {name}! 🚀 Давай зробимо цей світ трішки яскравішим ✨",
    "Радий бачити тебе, {name}! 🌈 Почнемо нову пригоду разом 😉",
    "Вітаю, {name}! 🙌 Готовий додати щось класне у твій день?",
    "{name}, привіт! 🌟 Я вже чекав нашої зустрічі!",
    "Привіт-привіт, {name}! 🎉 Час творити щось цікаве 😉",
    "Хей, {name}! 🔥 Настав час зробити цей момент особливим!",
  ],
  en: [
    "Hey {name}! 🚀 Let’s make the world a little brighter ✨",
    "Welcome, {name}! 🌈 Ready to start something fun?",
    "Hi {name}! 🙌 Let’s make today awesome together.",
    "{name}, great to see you! 🌟 I was waiting for this moment!",
    "Hello {name}! 🎉 Let’s create something cool 😉",
    "Yo {name}! 🔥 Time to make things exciting!",
  ],
  ru: [
    "Привет, {name}! 🚀 Давай сделаем мир немного ярче ✨",
    "Рад тебя видеть, {name}! 🌈 Начнём что-то новое 😉",
    "Здравствуй, {name}! 🙌 Добавим позитива в твой день?",
    "{name}, привет! 🌟 Я ждал нашей встречи!",
    "Привет-привет, {name}! 🎉 Время для чего-то интересного 😉",
    "Хей, {name}! 🔥 Сделаем этот момент особенным!",
  ],
  de: [
    "Hallo {name}! 🚀 Lass uns die Welt etwas heller machen ✨",
    "Willkommen, {name}! 🌈 Bereit, etwas Neues zu starten?",
    "Hi {name}! 🙌 Machen wir den Tag gemeinsam besser.",
    "{name}, hallo! 🌟 Ich habe schon auf dich gewartet!",
    "Hey {name}! 🎉 Zeit, etwas Cooles zu schaffen 😉",
    "Servus {name}! 🔥 Lass uns das hier besonders machen!",
  ],
  fr: [
    "Salut {name}! 🚀 Rendons le monde un peu plus lumineux ✨",
    "Bienvenue, {name}! 🌈 Prêt pour une nouvelle aventure?",
    "Coucou {name}! 🙌 On rend la journée meilleure ensemble?",
    "{name}, salut! 🌟 J’attendais notre rencontre!",
    "Hey {name}! 🎉 On crée quelque chose de cool 😉",
    "Yo {name}! 🔥 Rendons ce moment spécial!",
  ]
};
function buildGreet({ name, lang, genderTone, firstTime=false }) {
  const first = (name || "").toString().trim() || ensurePersonaTone({ name, lang, genderTone });
  const emoji = ["😉","😊","🤝","✨","🚀"][Math.floor(Math.random()*5)];
  if (firstTime) {
    const pool = greetingsFirst[lang] || greetingsFirst.en;
    return pool[Math.floor(Math.random()*pool.length)].replace("{name}", first);
  }
  if (lang === "uk") return `${first}, привіт ${emoji} Як настрій сьогодні?`;
  if (lang === "ru") return `${first}, привет ${emoji} Как настроение сегодня?`;
  if (lang === "de") return `${first}, hallo ${emoji} Wie geht’s dir heute?`;
  if (lang === "fr") return `${first}, salut ${emoji} Comment ça va aujourd’hui?`;
  return `${first}, hi ${emoji} How’s it going today?`;
}

// NER валют
const CURR_MAP = new Map([
  ["uah","UAH"], ["грн","UAH"], ["гривн","UAH"], ["гривня","UAH"], ["гривні","UAH"], ["₴","UAH"],
  ["usd","USD"], ["$","USD"], ["долар","USD"], ["доларів","USD"], ["доллары","USD"], ["доллар","USD"], ["бакс","USD"], ["бакси","USD"],
  ["eur","EUR"], ["€","EUR"], ["євро","EUR"], ["евро","EUR"],
]);
function normCurrencyToken(tok){ if(!tok) return null; const k=tok.toLowerCase(); return CURR_MAP.get(k)||tok.toUpperCase(); }
function parseNumbersAndCurrency(text) {
  const out = { amount: 1, base: null, quote: null };
  if (!text) return out;
  const t = text.replace(/\s+/g," ").trim();
  const mAmtCompact = t.match(/(\d+(?:[.,]\d+)?)(?=\s*[€$₴]|(?:\s|$))/);
  const mAmtLoose = t.match(/(\d+(?:[.,]\d+)?)/);
  if (mAmtCompact) out.amount = Number(mAmtCompact[1].replace(",","."));
  else if (mAmtLoose) out.amount = Number(mAmtLoose[1].replace(",","."));
  const afterAmt = t.match(/(\d+(?:[.,]\d+)?)[\s]*([€$₴]|usd|eur|uah|грн|гривн\w*|долар\w*|доллар\w*|євро|евро)/i);
  if (afterAmt) out.base = normCurrencyToken(afterAmt[2]);
  const hintTo = t.match(/(?:в|у|to|in)\s+([A-Za-zА-Яа-яІЇЄҐёЁ€$₴]+)/i);
  if (hintTo) out.quote = normCurrencyToken(hintTo[1].replace(/[^\p{L}€$₴]/gu,""));
  if (!out.base && /курс\s+(гривн|гривні|uah|грн)/i.test(t)) out.base = "UAH";
  if (!out.base && /курс\s+(долар|usd|\$)/i.test(t)) out.base = "USD";
  if (!out.base && /курс\s+(євро|eur|€)/i.test(t)) out.base = "EUR";
  if (out.base && !out.quote) out.quote = out.base === "UAH" ? "USD" : "UAH";
  return out;
}

/////////////////////////////
// FX (AUTO / NBU)
const AUTO_TTL = 12 * 3600; // 12h
const NBU_TTL  = 30 * 60;   // 30m
function fmtNum(n){ return Number(n).toLocaleString("en-US",{ maximumSignificantDigits: 6 }); }

async function fetchAutoRate(base, quote) {
  try {
    const u1 = `https://api.exchangerate.host/latest?base=${base}&symbols=${quote}`;
    const r1 = await fetch(u1, { cf:{cacheTtl:300, cacheEverything:true} });
    if (r1.ok) { const j = await r1.json(); if (j?.rates?.[quote]) return j.rates[quote]; }
  } catch {}
  try {
    const u2 = `https://open.er-api.com/v6/latest/${base}`;
    const r2 = await fetch(u2, { cf:{cacheTtl:300, cacheEverything:true} });
    if (r2.ok) { const j = await r2.json(); if (j?.rates?.[quote]) return j.rates[quote]; }
  } catch {}
  return null;
}
async function fetchNbuRate(base, quote) {
  let rate = null;
  if (base !== "UAH" && quote === "UAH") {
    const u = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${base}&json`;
    const r = await fetch(u, { cf:{cacheTtl:300, cacheEverything:true} });
    if (r.ok) { const j = await r.json(); rate = j?.[0]?.rate; }
  } else if (base === "UAH" && quote !== "UAH") {
    const u = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${quote}&json`;
    const r = await fetch(u, { cf:{cacheTtl:300, cacheEverything:true} });
    if (r.ok) { const j = await r.json(); rate = 1/(j?.[0]?.rate); }
  } else if (base !== "UAH" && quote !== "UAH") {
    const uBase = await fetchNbuRate(base, "UAH");
    const uQuote = await fetchNbuRate(quote, "UAH");
    if (uBase && uQuote) rate = uBase / uQuote;
  } else rate = 1;
  return rate;
}
async function handleFX(env, { text, parsed, defaultFiat, replyLang }) {
  const wantsNBU = /(?:\bNBU\b|\bНБУ\b|\bnbu\b|\bнбу\b)/i.test(text || "");
  const amount = parsed?.amount ?? 1;
  const base = parsed?.base || "UAH";
  const quote = parsed?.quote || defaultFiat || "USD";
  const k = wantsNBU ? `fx:nbu:${base}->${quote}` : `fx:auto:${base}->${quote}`;
  let rate = await env.AIMAGIC_SESS.get(k, "json");
  if (!rate) {
    rate = wantsNBU ? await fetchNbuRate(base, quote) : await fetchAutoRate(base, quote);
    if (rate) await env.AIMAGIC_SESS.put(k, JSON.stringify(rate), { expirationTtl: wantsNBU ? NBU_TTL : AUTO_TTL });
  }
  if (!rate) {
    const msg = replyLang==="uk"?"Не вдалося отримати курс.":"Failed to fetch rate.";
    return { text: msg };
  }
  const tag = wantsNBU ? (replyLang==="uk"||replyLang==="ru"?"(НБУ)":"(NBU)") : "";
  const line = amount!==1
    ? `${amount} ${base} ≈ ${fmtNum(amount*rate)} ${quote}${tag?" "+tag:""}`
    : `1 ${base} ≈ ${fmtNum(rate)} ${quote}${tag?" "+tag:""}`;
  // safety clean (раптом старий кеш): прибрати "(ER)"
  return { text: line.replace(/\s*\(ER\)/g, "") };
}

/////////////////////////////
// Crypto (Coingecko)
const CG_MAP = { btc: "bitcoin", eth: "ethereum", usdt: "tether", usdc: "usd-coin", bnb: "binancecoin", sol: "solana", ton: "the-open-network" };
async function handleCrypto(env, { text, parsed, defaultFiat, replyLang }) {
  const m = (text || "").toLowerCase().match(/\b(btc|eth|usdt|usdc|bnb|sol|ton)\b/);
  const coinKey = m ? m[1] : "btc";
  const coin = CG_MAP[coinKey];
  const fiat = (defaultFiat || "UAH").toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=${fiat}`;
  try {
    const r = await fetch(url, { cf:{cacheTtl:60, cacheEverything:true} });
    if (!r.ok) throw new Error();
    const j = await r.json();
    const price = j?.[coin]?.[fiat];
    if (!price) throw new Error();
    const label = replyLang==="uk"?"Курс":"Rate";
    return { text: `${label} ${coinKey.toUpperCase()}: ${fmtNum(price)} ${defaultFiat || "UAH"}` };
  } catch {
    const msg = replyLang==="uk"?"Не вдалося отримати курс крипти.":"Failed to fetch crypto price.";
    return { text: msg };
  }
}

/////////////////////////////
// Gifts (дуже коротко)
function handleGifts(env, { text, parsed, defaultFiat, replyLang }) {
  const t = (replyLang==="uk")
    ? ["• Настільна гра","• Пауербанк","• Бездротові навушники","• Сертифікат на враження","• Книга у жанрі, що любиш"]
    : ["• Board game","• Power bank","• Wireless earbuds","• Experience gift card","• A book you like"];
  const hdr = replyLang==="uk"?"Ідеї подарунків:":"Gift ideas:";
  return { text: `${hdr}\n${t.join("\n")}` };
}

/////////////////////////////
// Calendar & Holidays
const OFFICIAL_FIXED = {
  "01-01": { uk: "Новий рік", en: "New Year’s Day" },
  "03-08": { uk: "Міжнародний жіночий день", en: "International Women’s Day" },
  "06-28": { uk: "День Конституції України", en: "Constitution Day of Ukraine" },
  "08-24": { uk: "День Незалежності України", en: "Independence Day of Ukraine" },
  "10-14": { uk: "День захисників і захисниць України", en: "Defenders Day of Ukraine" },
  "12-25": { uk: "Різдво Христове (григоріан.)", en: "Christmas Day (Gregorian)" },
};
const UNOFFICIAL_FIXED = {
  "02-14": { uk: "День святого Валентина", en: "Valentine’s Day" },
  "01-24": { uk: "День компліментів", en: "Compliment Day" },
  "04-01": { uk: "День сміху", en: "April Fools’ Day" },
  "10-31": { uk: "Геловін", en: "Halloween" },
  "12-31": { uk: "Новий рік (зустріч)", en: "New Year’s Eve" },
};
function programmersDayKey(year){ const s=new Date(Date.UTC(year,0,1)); const d=new Date(s.getTime()+(256-1)*86400000); return `${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`; }
const WEEKDAYS = { uk: ["неділя","понеділок","вівторок","середа","четвер","п’ятниця","субота"], en:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"] };
async function handleCalendar(env, { text, replyLang }) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let d = new Date(today);
  if (/вчора|yesterday/i.test(text||"")) d = new Date(today.getTime()-86400000);
  if (/завтра|tomorrow/i.test(text||"")) d = new Date(today.getTime()+86400000);
  const key = `${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
  const wd = (WEEKDAYS[replyLang]||WEEKDAYS.en)[d.getUTCDay()];
  const dateLine = replyLang==="uk"
    ? `Сьогодні: ${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}.${d.getUTCFullYear()} (${wd})`
    : `Today: ${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}.${d.getUTCFullYear()} (${wd})`;
  const wantsUnofficial = /(а\s+не\s+офіційного|неофициального|unofficial|international)/i.test(text||"");
  const list = [];
  if (OFFICIAL_FIXED[key]) list.push(OFFICIAL_FIXED[key][replyLang] || OFFICIAL_FIXED[key].en);
  if (programmersDayKey(d.getUTCFullYear())===key) list.push(replyLang==="uk"?"День програміста":"Programmer’s Day");
  if (wantsUnofficial && UNOFFICIAL_FIXED[key]) list.push(UNOFFICIAL_FIXED[key][replyLang] || UNOFFICIAL_FIXED[key].en);
  const noHol = replyLang==="uk"?"Схоже, офіційного свята немає.":"Looks like there’s no official holiday.";
  let out = [dateLine];
  if (list.length) out.push(...list.map(h=>"• "+h));
  else out.push(noHol);
  return { text: out.join("\n") };
}

/////////////////////////////
// Media
async function handleMedia(env, { chatId, replyLang, mode }) {
  if (mode === "hint") return { text: null };
  if (mode === "friendly") {
    const msg =
      replyLang === "uk" ? "Гарний настрій бачу 😄" :
      replyLang === "ru" ? "Классное настроение вижу 😄" :
      replyLang === "de" ? "Gute Stimmung sehe ich 😄" :
      replyLang === "fr" ? "Bonne vibe, je vois 😄" :
      "Nice vibe 😄";
    return { text: msg };
  }
  return { text: null };
}

/////////////////////////////
// Commands
const CMD_SET_FIAT = new Set(["/uah","/usd","/eur"]);
async function handleSetFiat(env, chatId, cmd) {
  const code = cmd.replace("/", "").toUpperCase();
  const iso = { UAH:"UAH", USD:"USD", EUR:"EUR" }[code] || code;
  await setDefaultFiat(env, chatId, iso);
  const reply =
    iso==="UAH" ? "Базову валюту встановлено: UAH (гривня)." :
    iso==="USD" ? "Базову валюту встановлено: USD (долар)." :
    iso==="EUR" ? "Базову валюту встановлено: EUR (євро)." :
    `Базову валюту встановлено: ${iso}.`;
  await tgSendMessage(env, chatId, reply);
}

/////////////////////////////
// Dispatcher
async function dispatchMessage(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg) return;
  const chatId = msg.chat?.id; if (!chatId) return;

  tgSendChatAction(env, chatId, "typing");

  const userName = msg.from?.first_name || msg.from?.username || (msg.from?.language_code ? "друже" : "friend");
  let text = msg.text || msg.caption || "";

  const isPhoto = Boolean(msg.photo?.length);
  const isSticker = Boolean(msg.sticker);
  const isAnimation = Boolean(msg.animation);
  const hasMedia = isPhoto || isSticker || isAnimation;

  const lastLang = (await getChatLangKV(env, chatId)) || "uk";
  const detectedLang = text ? await detectLang(text) : lastLang;
  const replyLang = detectedLang || lastLang;
  if (replyLang !== lastLang) await setChatLangKV(env, chatId, replyLang);

  const genderTone = extractGenderTone(text||"");

  // Команди валюти
  if (text && CMD_SET_FIAT.has(text.trim().toLowerCase())) {
    await handleSetFiat(env, chatId, text.trim().toLowerCase());
    return;
  }

  // ===== Greeting logic =====
  if (text && /^\/start\b/i.test(text.trim())) {
    const greet = buildGreet({ name: userName, lang: replyLang, genderTone, firstTime: true });
    await tgSendMessage(env, chatId, greet);
    return;
  }
  if (text && /\b(привіт|привет|hello|hi|hola|salut|hallo)\b/i.test(text)) {
    const greet = buildGreet({ name: userName, lang: replyLang, genderTone, firstTime: false });
    await tgSendMessage(env, chatId, greet);
    return;
  }

  // 1) Media без тексту → підказка
  if (hasMedia && !text) {
    await handleMedia(env, { chatId, replyLang, mode: "hint" });
    await tgReplyMediaHint(env, chatId, replyLang);
    return;
  }

  // 2) FX (fiat)
  if (text && /\b(курс|nbu|нбу|usd|eur|uah|\$|€|грн|долар|євро|гривн)/i.test(text)) {
    const defaultFiat = await getDefaultFiat(env, chatId);
    const parsed = parseNumbersAndCurrency(text);
    const res = await handleFX(env, { text, parsed, defaultFiat, replyLang });
    if (res?.text) { await tgSendMessage(env, chatId, res.text); return; }
  }

  // 3) Crypto
  if (text && /\b(btc|eth|usdt|usdc|bnb|sol|ton|крипто|crypto)\b/i.test(text)) {
    const defaultFiat = await getDefaultFiat(env, chatId);
    const parsed = parseNumbersAndCurrency(text);
    const res = await handleCrypto(env, { text, parsed, defaultFiat, replyLang });
    if (res?.text) { await tgSendMessage(env, chatId, res.text); return; }
  }

  // 4) Calendar
  if (text && /(сьогодні|вчора|завтра|дата|який сьогодні день|свята|а не офіційного)/i.test(text)) {
    const res = await handleCalendar(env, { text, replyLang });
    if (res?.text) { await tgSendMessage(env, chatId, res.text); return; }
  }

  // 5) Gifts
  if (text && /(подар|ідеї|що подарувати|gift)/i.test(text)) {
    const defaultFiat = await getDefaultFiat(env, chatId);
    const parsed = parseNumbersAndCurrency(text);
    const res = handleGifts(env, { text, parsed, defaultFiat, replyLang });
    if (res?.text) { await tgSendMessage(env, chatId, res.text); return; }
  }

  // 6) Media емоційні
  if (text && /(емодзі|emoji|стікер|стикер|gif|гіф|настрій|весело|сумно|люблю|клас)/i.test(text)) {
    const res = await handleMedia(env, { chatId, replyLang, mode: "friendly" });
    if (res?.text) { await tgSendMessage(env, chatId, res.text); }
    return;
  }

  // 7) Fallback LLM
  const persona = ensurePersonaTone({ name: userName, lang: replyLang, genderTone });
  const prompt =
    replyLang === "uk"
      ? `Ти — Senti, доброзичливий асистент. Відповідай коротко, чітко, без вигадок. Якщо намір неясний — чемно уточни.
Користувач (${persona}): ${text || "(без тексту)"}`
      : replyLang === "ru"
      ? `Ты — Senti, дружелюбный ассистент. Отвечай кратко и чётко, без выдумок. Если намерение неясно — вежливо уточни.
Пользователь (${persona}): ${text || "(без текста)"}`
      : replyLang === "de"
      ? `Du bist Senti, ein freundlicher Assistent. Antworte kurz und präzise. Wenn unklar — höflich nachfragen.
Nutzer (${persona}): ${text || "(kein Text)"}`
      : replyLang === "fr"
      ? `Tu es Senti, un assistant amical. Réponds brièvement et clairement. Si c’est flou — demande poliment.
Utilisateur (${persona}) : ${text || "(sans texte)"}`
      : `You are Senti, a friendly assistant. Reply briefly and clearly. If intent is unclear — politely ask.
User (${persona}): ${text || "(no text)"}`;

  try {
    const aiRes = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      prompt,
      max_tokens: 256,
      temperature: 0.4,
    });
    const answer = (aiRes?.response || "").trim() || (replyLang === "uk" ? "Можеш уточнити, будь ласка?" : "Could you clarify?");
    await tgSendMessage(env, chatId, answer);
  } catch (e) {
    const fail =
      replyLang === "uk" ? "Тимчасова помилка відповіді. Спробуй ще раз." :
      replyLang === "ru" ? "Временная ошибка ответа. Попробуй ещё раз." :
      replyLang === "de" ? "Vorübergehender Fehler. Bitte versuche es erneut." :
      replyLang === "fr" ? "Erreur temporaire. Réessaie." :
      "Temporary error. Please try again.";
    await tgSendMessage(env, chatId, fail);
  }
}

/////////////////////////////
// Worker entry
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Healthcheck
      if (request.method === "GET" && url.pathname === "/") {
        return new Response("Senti v4.1 up", { status: 200 });
      }

      // Webhook endpoint: /<WEBHOOK_SECRET> (наприклад /senti1984)
      if (url.pathname === `/${env.WEBHOOK_SECRET}`) {
        if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
        const update = await request.json().catch(() => null);
        if (!update) return new Response("Bad Request", { status: 400 });

        ctx.waitUntil(dispatchMessage(env, update));
        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      return new Response("Internal Error", { status: 500 });
    }
  },
};