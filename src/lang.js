// src/lang.js — language & NER utils for Senti v4.1

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

// ===== Greetings =====

// Вітання при /start (емоційні, кілька варіантів)
const greetingsFirst = {
  uk: [
    "Привіт, {name}! 🚀 Давай зробимо цей світ трішки яскравішим ✨",
    "Радий бачити тебе, {name}! 🌈 Почнемо нову пригоду разом 😉",
    "Вітаю, {name}! 🙌 Готовий додати щось класне у твій день?",
    "{name}, привіт! 🌟 Я вже чекав нашої зустрічі!",
    "Привіт-привіт, {name}! 🎉 Час творити щось цікаве 😉",
    "Хей, {name}! 🔥 Настав час зробити цей вечір особливим!",
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
    "Хей, {name}! 🔥 Сделаем этот день особенным!",
  ],
  de: [
    "Hallo {name}! 🚀 Lass uns die Welt etwas heller machen ✨",
    "Willkommen, {name}! 🌈 Bereit, etwas Neues zu starten?",
    "Hi {name}! 🙌 Machen wir den Tag gemeinsam besser.",
    "{name}, hallo! 🌟 Ich habe schon auf dich gewartet!",
    "Hey {name}! 🎉 Zeit, etwas Cooles zu schaffen 😉",
    "Servus {name}! 🔥 Lass uns heute besonders machen!",
  ],
  fr: [
    "Salut {name}! 🚀 Rendons le monde un peu plus lumineux ✨",
    "Bienvenue, {name}! 🌈 Prêt pour une nouvelle aventure?",
    "Coucou {name}! 🙌 On rend la journée meilleure ensemble?",
    "{name}, salut! 🌟 J’attendais notre rencontre!",
    "Hey {name}! 🎉 On crée quelque chose de cool 😉",
    "Yo {name}! 🔥 Rendons ce soir spécial!",
  ]
};

// Звичайне привітання (“Привіт” і т.п.)
export function buildGreet({ name, lang, genderTone, firstTime=false }) {
  const first = (name || "").toString().trim() || ensurePersonaTone({ name, lang, genderTone });
  const emoji = ["😉","😊","🤝","✨","🚀"][Math.floor(Math.random()*5)];

  if (firstTime) {
    const pool = greetingsFirst[lang] || greetingsFirst["en"];
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return pick.replace("{name}", first);
  }

  // Звичайне тепле привітання
  if (lang === "uk") return `${first}, привіт ${emoji} Як настрій сьогодні?`;
  if (lang === "ru") return `${first}, привет ${emoji} Как настроение сегодня?`;
  if (lang === "de") return `${first}, hallo ${emoji} Wie geht’s dir heute?`;
  if (lang === "fr") return `${first}, salut ${emoji} Comment ça va aujourd’hui?`;
  return `${first}, hi ${emoji} How’s it going today?`;
}

// ===== Gender tone extractor =====
export function extractGenderTone(text) {
  const t = (text || "").toLowerCase();
  if (!t) return "neutral";
  if (/(подруго|сестро|sis|я\s+дівчина|я\s+женщина)/i.test(t)) return "fem";
  if (/(друже|бро|bro|я\s+хлопець|я\s+мужчина)/i.test(t)) return "masc";
  return "neutral";
}

// ===== Numbers & currency NER (без змін) =====
/* ... (залишаємо все як у попередньому lang.js, тут обрізав для стислості) ... */