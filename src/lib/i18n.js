// src/lib/i18n.js

// мінімальний набір фраз (залишаю твої ключі; доповни за потреби)
const DICT = {
  hello_name: {
    uk: (name) => `Привіт, ${name}!`,
    ru: (name) => `Привет, ${name}!`,
    en: (name) => `Hi, ${name}!`,
    de: (name) => `Hallo, ${name}!`,
    fr: (name) => `Salut, ${name}!`,
  },
  how_help: {
    uk: "Чим можу допомогти?",
    ru: "Чем могу помочь?",
    en: "How can I help?",
    de: "Womit kann ich helfen?",
    fr: "Comment puis-je aider ?",
  },
  default_reply: {
    uk: "Спробуй переформулювати, будь ласка.",
    ru: "Попробуй переформулировать, пожалуйста.",
    en: "Please try to rephrase.",
    de: "Bitte formuliere es um.",
    fr: "Essaie de reformuler, s’il te plaît.",
  },
  senti_tip: {
    uk: "Надішли /ai і запит.",
    ru: "Отправь /ai и запрос.",
    en: "Send /ai and your query.",
    de: "Sende /ai und deine Frage.",
    fr: "Envoie /ai et ta question.",
  },
  need_energy_text: {
    uk: (need, url) => `Потрібно ${need} енергії. Керувати: ${url}`,
    ru: (need, url) => `Нужно ${need} энергии. Управление: ${url}`,
    en: (need, url) => `Need ${need} energy. Manage: ${url}`,
    de: (need, url) => `${need} Energie benötigt. Verwalten: ${url}`,
    fr: (need, url) => `Besoin de ${need} énergie. Gérer : ${url}`,
  },
  need_energy_media: {
    uk: (need, url) => `Для медіа потрібно ${need} енергії. Керувати: ${url}`,
    ru: (need, url) => `Для медиа нужно ${need} энергии. Управление: ${url}`,
    en: (need, url) => `Media needs ${need} energy. Manage: ${url}`,
    de: (need, url) => `Für Medien sind ${need} Energie nötig. Verwalten: ${url}`,
    fr: (need, url) => `Les médias nécessitent ${need} énergie. Gérer : ${url}`,
  },
  open_drive_btn: {
    uk: "Відкрити Google Drive",
    ru: "Открыть Google Drive",
    en: "Open Google Drive",
    de: "Google Drive öffnen",
    fr: "Ouvrir Google Drive",
  },
  low_energy_notice: {
    uk: (left, url) => `Залишилось ${left} енергії. Керування: ${url}`,
    ru: (left, url) => `Осталось ${left} энергии. Управление: ${url}`,
    en: (left, url) => `${left} energy left. Manage: ${url}`,
    de: (left, url) => `${left} Energie übrig. Verwalten: ${url}`,
    fr: (left, url) => `Il reste ${left} d’énergie. Gérer : ${url}`,
  },
};

export function t(lang, key, ...args) {
  const L = (lang || "uk").slice(0,2);
  const entry = DICT[key];
  if (!entry) return key;
  const f = entry[L] || entry.uk || Object.values(entry)[0];
  return typeof f === "function" ? f(...args) : f;
}

/**
 * pickReplyLanguage
 * 1) якщо є msg.from.language_code → беремо його
 * 2) якщо в тексті явно інша мова (детектор) — віддаємо її
 * 3) fallback: uk
 */
export function pickReplyLanguage(msg, text) {
  const from = (msg?.from?.language_code || "").slice(0,2).toLowerCase();
  // if telegram profile has known language — prefer it
  if (["uk","ru","en","de","fr"].includes(from)) return from;

  // else detect from text (дуже грубо)
  const s = String(text || "").toLowerCase();
  if (/[a-z]/.test(s) && /\b(the|and|what|how|please)\b/.test(s)) return "en";
  if (/[а-яё]/.test(s) && /\b(привет|пожалуйста|спасибо)\b/.test(s)) return "ru";
  if (/[a-zäöüß]/.test(s) && /\b(und|wie|bitte|danke)\b/.test(s)) return "de";
  if (/[a-zàâçéèêëîïôûùüÿœ]/.test(s) && /\b(merci|s'il vous plaît|comment)\b/.test(s)) return "fr";

  return "uk";
}

// максимально проста «детекція» мови готової відповіді (щоб не ламати тобі існуючу логіку)
export function detectFromText(out = "") {
  const s = String(out || "").toLowerCase();
  if (/[а-яёіїєґ]/.test(s)) {
    // спробуємо розрізнити укр/ру
    if (/[іїєґ]/.test(s)) return "uk";
    return "ru";
  }
  if (/[äöüß]/.test(s)) return "de";
  if (/[àâçéèêëîïôûùüÿœ]/.test(s)) return "fr";
  return "en";
} 
