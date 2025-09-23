// Senti Bot Worker — v4.1.4 (ESM monolith)
// Root "/": ok, Health "/_status": JSON (version)
// Bindings: KV AIMAGIC_SESS; secrets: TELEGRAM_TOKEN, WEBHOOK_SECRET, DEFAULT_FIAT

// ---------- KV helpers ----------
const kvKey = (chatId, key) => `chat:${chatId}:${key}`;
async function getDefaultFiat(env, chatId) {
  const v = await env.AIMAGIC_SESS.get(kvKey(chatId, "default_fiat"));
  return v || env.DEFAULT_FIAT || "UAH";
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

// ---------- Telegram ----------
async function tgSendChatAction(env, chat_id, action = "typing") {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendChatAction`;
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id, action }) }).catch(()=>{});
}
async function tgSendMessage(env, chat_id, text, opts = {}) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
  const body = { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...opts };
  await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(()=>{});
}

// ---------- Lang & tone ----------
function mapUserLang(code) {
  const c = (code || "").toLowerCase();
  if (c.startsWith("uk")) return "uk";
  if (c.startsWith("ru")) return "ru";
  if (c.startsWith("de")) return "de";
  if (c.startsWith("fr")) return "fr";
  return "en";
}
const langHints = {
  uk: /[іїєґІЇЄҐ]|(привіт|будь ласка|дякую|сьогодні|грн|долар|євро)/i,
  ru: /[ёЁъЪыЫэЭ]|(привет|пожалуйста|спасибо|сегодня|руб|доллар|евро)/i,
  de: /\b(und|oder|nicht|heute|morgen|euro|danke|bitte)\b/i,
  fr: /\b(et|ou|pas|aujourd’hui|demain|merci|s’il vous plaît|euro)\b/i,
  en: /\b(and|or|please|thanks|today|tomorrow|usd|euro|dollar)\b/i,
};
async function detectLang(text, fallback="uk") {
  if (!text) return fallback;
  const t = text.trim();
  if (langHints.uk.test(t)) return "uk";
  if (langHints.ru.test(t)) return "ru";
  if (langHints.de.test(t)) return "de";
  if (langHints.fr.test(t)) return "fr";
  if (langHints.en.test(t)) return "en";
  if (/[A-Za-z]/.test(t) && !/[А-Яа-яІЇЄҐЁЪЫЭ]/.test(t)) return "en";
  return fallback;
}
function extractGenderTone(text) {
  const t = (text || "").toLowerCase();
  if (/(подруго|сестро|sis|я\s+дівчина|я\s+женщина)/i.test(t)) return "fem";
  if (/(друже|бро|bro|я\s+хлопець|я\s+мужчина)/i.test(t)) return "masc";
  return "neutral";
}
function ensurePersonaTone({ name, lang, genderTone }) {
  const first = (name || "").toString().trim();
  if (first) return first;
  if (genderTone === "fem") return lang==="uk"?"подруго":lang==="ru"?"подруга":"sis";
  if (genderTone === "masc") return lang==="uk"?"друже":lang==="ru"?"друг":"bro";
  return lang==="uk"?"друже":lang==="ru"?"друг":"friend";
}

// ---------- Greetings ----------
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

// ---------- NER (валюти) ----------
const CURR_MAP = new Map([
  ["uah","UAH"], ["грн","UAH"], ["гривн","UAH"], ["гривня","UAH"], ["гривні","UAH"], ["₴","UAH"],
  ["usd","USD"], ["$","USD"], ["долар","USD"], ["доларів","USD"], ["доллар","USD"], ["бакс","USD"], ["бакси","USD"],
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

// ---------- FX ----------
const AUTO_TTL = 12 * 3600;
const NBU_TTL  = 30 * 60;
function fmtNum(n){ return Number(n).toLocaleString("en-US",{ maximumSignificantDigits: 6 }); }

async function fetchAutoRate(base, quote) {
  // 1) exchangerate.host
  try {
    const u1 = `https://api.exchangerate.host/latest?base=${base}&symbols=${quote}`;
    const r1 = await fetch(u1, { cf:{cacheTtl:300, cacheEverything:true} });
    if (r1.ok) { const j = await r1.json(); if (j?.rates?.[quote]) return j.rates[quote]; }
  } catch {}
  // 2) open.er-api.com
  try {
    const u2 = `https://open.er-api.com/v6/latest/${base}`;
    const r2 = await fetch(u2, { cf:{cacheTtl:300, cacheEverything:true} });
    if (r2.ok) { const j = await r2.json(); if (j?.rates?.[quote]) return j.rates[quote]; }
  } catch {}
  // 3) frankfurter.app
  try {
    const u3 = `https://api.frankfurter.app/latest?from=${base}&to=${quote}`;
    const r3 = await fetch(u3, { cf:{cacheTtl:300, cacheEverything:true} });
    if (r3.ok) { const j = await r3.json(); if (j?.rates?.[quote]) return j.rates[quote]; }
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

async function doFX(env, { text, parsed, defaultFiat, replyLang }) {
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
  if (!rate) return { text: replyLang==="uk"?"Не вдалося отримати курс.":"Failed to fetch rate." };

  const tag = wantsNBU ? (replyLang==="uk"||replyLang==="ru"?"(НБУ)":"(NBU)") : "";
  const line = (amount!==1)
    ? `${amount} ${base} ≈ ${fmtNum(amount*rate)} ${quote}${tag?" "+tag:""}`
    : `1 ${base} ≈ ${fmtNum(rate)} ${quote}${tag?" "+tag:""}`;
  return { text: line };
}

// ---------- Crypto ----------
const CG_MAP = { btc:"bitcoin", eth:"ethereum", usdt:"tether", usdc:"usd-coin", bnb:"binancecoin", sol:"solana", ton:"the-open-network" };
async function doCrypto(env, text) {
  const m = (text || "").toLowerCase().match(/\b(btc|eth|usdt|usdc|bnb|sol|ton)\b/);
  const coinKey = m ? m[1] : "btc";
  const coin = CG_MAP[coinKey];
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=uah,usd,eur`;
  try {
    const r = await fetch(url, { cf:{cacheTtl:60, cacheEverything:true} });
    const j = await r.json();
    const uah = j?.[coin]?.uah, usd = j?.[coin]?.usd, eur = j?.[coin]?.eur;
    if (!uah && !usd && !eur) throw new Error();
    return { text: `Курс ${coinKey.toUpperCase()}: ${uah?fmtNum(uah)+" UAH":""}${usd?" | "+fmtNum(usd)+" USD":""}${eur?" | "+fmtNum(eur)+" EUR":""}`.replace(/\|\s*$/, "") };
  } catch { return { text: "Не вдалося отримати курс крипти." }; }
}

// ---------- Calendar ----------
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
const WEEKDAYS = { uk:["неділя","понеділок","вівторок","середа","четвер","п’ятниця","субота"], en:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"] };
async function doCalendar(env, { text, replyLang }) {
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
  if (list.length) out.push(...list.map(h=>"• "+h)); else out.push(noHol);
  return { text: out.join("\n") };
}

// ---------- Media ----------
async function doMedia(_env, { replyLang, mode }) {
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

// ---------- Commands ----------
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

// ---------- Dispatcher ----------
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

  // /start → мову беремо з Telegram language_code; інакше — KV/детект
  const userLangPref = mapUserLang(msg.from?.language_code);
  let lastLang = (await getChatLangKV(env, chatId)) || userLangPref || "uk";
  let replyLang = lastLang;

  if (text && !/^\/start\b/i.test(text.trim())) {
    const detected = await detectLang(text, lastLang);
    replyLang = detected;
    if (replyLang !== lastLang) { await setChatLangKV(env, chatId, replyLang); lastLang = replyLang; }
  } else {
    await setChatLangKV(env, chatId, userLangPref);
    replyLang = userLangPref;
  }

  const genderTone = extractGenderTone(text||"");

  // зміна базової валюти
  if (text && CMD_SET_FIAT.has(text.trim().toLowerCase())) {
    await handleSetFiat(env, chatId, text.trim().toLowerCase()); return;
  }

  // greetings
  if (text && /^\/start\b/i.test(text.trim())) {
    const greet = buildGreet({ name: userName, lang: replyLang, genderTone, firstTime: true });
    await tgSendMessage(env, chatId, greet); return;
  }
  if (text && /\b(привіт|привет|hello|hi|hola|salut|hallo)\b/i.test(text)) {
    const greet = buildGreet({ name: userName, lang: replyLang, genderTone, firstTime: false });
    await tgSendMessage(env, chatId, greet); return;
  }

  // media без тексту → хінт
  if (hasMedia && !text) {
    const hint =
      replyLang==="uk"?"Надішли фото без підпису — можу описати, покращити чи стилізувати.":
      replyLang==="ru"?"Пришли фото без подписи — опишу, улучшу или стилизую.":
      replyLang==="de"?"Sende ein Foto ohne Text – ich kann es beschreiben oder verbessern.":
      replyLang==="fr"?"Envoie une photo sans texte – je peux décrire ou améliorer.":
      "Send a photo without caption — I can describe or enhance.";
    await tgSendMessage(env, chatId, hint);
    return;
  }

  // INTENT PRIORITY: FX → Crypto → Calendar

  if (text && /(курс|nbu|нбу|usd|eur|uah|\$|€|грн|долар|євро|гривн)/i.test(text)) {
    try {
      const defaultFiat = await getDefaultFiat(env, chatId);
      const parsed = parseNumbersAndCurrency(text);
      const res = await doFX(env, { text, parsed, defaultFiat, replyLang });
      await tgSendMessage(env, chatId, res.text);
      return;
    } catch {
      await tgSendMessage(env, chatId, replyLang==="uk"?"Сталась помилка з курсом.":"FX error.");
      return;
    }
  }

  if (text && /\b(btc|eth|usdt|usdc|bnb|sol|ton|крипто|crypto|біткоін|биткоин)\b/i.test(text)) {
    const res = await doCrypto(env, text);
    await tgSendMessage(env, chatId, res.text);
    return;
  }

  if (text && /(сьогодні|вчора|завтра|дата|який сьогодні день|свята|а не офіційного)/i.test(text)) {
    const res = await doCalendar(env, { text, replyLang });
    await tgSendMessage(env, chatId, res.text);
    return;
  }

  if (text && /(емодзі|emoji|стікер|стикер|gif|гіф|настрій|весело|сумно|люблю|клас)/i.test(text)) {
    const r = await doMedia(env, { replyLang, mode: "friendly" });
    if (r?.text) await tgSendMessage(env, chatId, r.text);
    return;
  }

  const persona = ensurePersonaTone({ name: userName, lang: replyLang, genderTone });
  const fallback = replyLang==="uk" ? `Окей, ${persona}. Спробуй переформулювати або дай більше деталей 😉` : 
                   replyLang==="ru" ? `Окей, ${persona}. Переформулируй или дай деталей 😉` :
                   replyLang==="de" ? `Okay, ${persona}. Formuliere um oder gib mehr Details 😉` :
                   replyLang==="fr" ? `D’accord, ${persona}. Reformule ou ajoute des détails 😉` :
                   `Okay, ${persona}. Please rephrase or add details 😉`;
  await tgSendMessage(env, chatId, fallback);
}

// ---------- Worker entry ----------
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/_status") {
        const body = JSON.stringify({ service: "senti-bot-worker", version: "v4.1.4-esm", time: new Date().toISOString() });
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      }
      if (request.method === "GET" && url.pathname === "/") {
        return new Response("ok", { status: 200 });
      }
      if (url.pathname === `/${env.WEBHOOK_SECRET}`) {
        if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
        const update = await request.json().catch(()=>null);
        if (!update) return new Response("Bad Request", { status: 400 });
        ctx.waitUntil(dispatchMessage(env, update));
        return new Response("OK", { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    } catch {
      return new Response("Internal Error", { status: 500 });
    }
  },
};
