// src/lib/i18n.js

const SUP = ["uk", "ru", "en", "de", "fr"];

// —————— language detection ——————
function detectFromText(text = "") {
  const s = String(text).trim();

  if (!s) return null;

  // Cyrillic vs Latin
  const hasCyr = /[А-Яа-яЁёЇїІіЄєҐґ]/.test(s);
  const hasLat = /[A-Za-z]/.test(s);

  if (hasCyr) {
    // RU markers
    if (/[ыэёъ]/i.test(s)) return "ru";
    // UK markers
    if (/[іїєґ]/i.test(s)) return "uk";
    // Heuristic by common words
    if (/\b(що|який|скільки|будь ласка|привіт)\b/i.test(s)) return "uk";
    if (/\b(что|какой|сколько|пожалуйста|привет)\b/i.test(s)) return "ru";
    return "uk"; // default for cyrillic
  }

  // German accents / words
  if (/[äöüßÄÖÜ]/.test(s) || /\b(der|die|das|und|ist|wie|viele|bist|heute)\b/i.test(s)) return "de";

  // French accents / words
  if (/[àâçéèêëîïôûùüÿœÀÂÇÉÈÊËÎÏÔÛÙÜŸŒ]/.test(s) ||
      /\b(qui|quoi|comment|bonjour|combien|est|tu)\b/i.test(s)) return "fr";

  // English: latin without umlauts/accents + common words
  if (hasLat) return "en";

  return null;
}

export function pickReplyLanguage(msg, text = "") {
  const fromText = detectFromText(text);
  if (fromText && SUP.includes(fromText)) return fromText;

  const code = (msg?.from?.language_code || "").slice(0, 2).toLowerCase();
  if (SUP.includes(code)) return code;

  // Chat-language fallback (for groups/clients that send chat language)
  const chatCode = (msg?.language_code || "").slice(0, 2).toLowerCase();
  if (SUP.includes(chatCode)) return chatCode;

  return "uk"; // final fallback
}

const L = {
  uk: {
    default_reply: "Вибач, я не зрозумів. Спробуєш інакше?",
    admin_denied: "Немає доступу.",
    admin_header: "Адмін-панель (швидка діагностика):",
    disk_on: "Режим диска: ON",
    open_drive_btn: "Відкрити Диск",
    hello_name: (n) => `Привіт, ${n}!`,
    how_help: "Як я можу допомогти?",
    senti_tip: "Пиши будь-якою мовою — відповім стисло. Скажеш «детальніше» — розгорну.",
    need_energy_text: (need, url) => `Бракує енергії (${need}). Поповнити: ${url}`,
    need_energy_media: (need, url) => `Для файлів бракує енергії (${need}). Поповнення: ${url}`,
    low_energy_notice: (left, url) => `Низький рівень енергії (${left}). Керування: ${url}`,
    saved_to_drive: "Збережено на Диск"
  },
  ru: {
    default_reply: "Извини, я не понял. Попробуешь иначе?",
    admin_denied: "Доступ запрещён.",
    admin_header: "Админ-панель (быстрая диагностика):",
    disk_on: "Режим диска: ON",
    open_drive_btn: "Открыть Диск",
    hello_name: (n) => `Привет, ${n}!`,
    how_help: "Как могу помочь?",
    senti_tip: "Пиши на любом языке — отвечу кратко. Скажи «подробнее» — разверну.",
    need_energy_text: (need, url) => `Не хватает энергии (${need}). Пополнить: ${url}`,
    need_energy_media: (need, url) => `Для файлов не хватает энергии (${need}). Пополнение: ${url}`,
    low_energy_notice: (left, url) => `Низкий уровень энергии (${left}). Управление: ${url}`,
    saved_to_drive: "Сохранено на Диск"
  },
  en: {
    default_reply: "Sorry, I didn’t get that. Could you rephrase?",
    admin_denied: "Access denied.",
    admin_header: "Admin panel (quick diagnostics):",
    disk_on: "Drive mode: ON",
    open_drive_btn: "Open Drive",
    hello_name: (n) => `Hi, ${n}!`,
    how_help: "How can I help?",
    senti_tip: "Use any language — I’ll reply concisely. Say “more details” to expand.",
    need_energy_text: (need, url) => `Not enough energy (${need}). Top up: ${url}`,
    need_energy_media: (need, url) => `Not enough energy for files (${need}). Top up: ${url}`,
    low_energy_notice: (left, url) => `Low energy (${left}). Manage: ${url}`,
    saved_to_drive: "Saved to Drive"
  },
  de: {
    default_reply: "Sorry, das habe ich nicht verstanden. Bitte anders formulieren?",
    admin_denied: "Zugriff verweigert.",
    admin_header: "Adminbereich (Schnelldiagnose):",
    disk_on: "Drive-Modus: AN",
    open_drive_btn: "Drive öffnen",
    hello_name: (n) => `Hallo, ${n}!`,
    how_help: "Womit kann ich helfen?",
    senti_tip: "Schreibe in jeder Sprache — ich antworte kurz. Mit „mehr Details“ erweitere ich.",
    need_energy_text: (need, url) => `Nicht genug Energie (${need}). Aufladen: ${url}`,
    need_energy_media: (need, url) => `Für Dateien fehlt Energie (${need}). Aufladen: ${url}`,
    low_energy_notice: (left, url) => `Wenig Energie (${left}). Verwalten: ${url}`,
    saved_to_drive: "Auf Drive gespeichert"
  },
  fr: {
    default_reply: "Désolé, je n’ai pas compris. Reformulez, svp.",
    admin_denied: "Accès refusé.",
    admin_header: "Panneau d’admin (diagnostic rapide) :",
    disk_on: "Mode Drive : ON",
    open_drive_btn: "Ouvrir Drive",
    hello_name: (n) => `Salut, ${n} !`,
    how_help: "Comment puis-je aider ?",
    senti_tip: "Écrivez dans n’importe quelle langue — je réponds brièvement. Dites « plus de détails » pour développer.",
    need_energy_text: (need, url) => `Énergie insuffisante (${need}). Recharger : ${url}`,
    need_energy_media: (need, url) => `Pas assez d’énergie pour les fichiers (${need}). Recharger : ${url}`,
    low_energy_notice: (left, url) => `Énergie faible (${left}). Gérer : ${url}`,
    saved_to_drive: "Enregistré sur Drive"
  }
};

export function t(lang, key, ...args) {
  const d = L[lang] || L.uk;
  const val = d[key] ?? L.uk[key] ?? key;
  if (typeof val === "function") return val(...args);
  if (!args.length) return val;
  // simple interpolation for two args max
  return String(val)
    .replace("%1", args[0] ?? "")
    .replace("%2", args[1] ?? "");
}

// also export detector for response-language check in webhook
export { detectFromText };