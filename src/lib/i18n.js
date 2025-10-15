// src/lib/i18n.js
// Локалізація + евристика визначення мови з тексту/TG.

export function detectLangFromText(s = "") {
  const t = (s || "").toLowerCase();
  if (/[äöüß]/.test(t) || /\b(der|die|und|ist|wer|bist|nicht|hallo)\b/.test(t)) return "de";
  if (/[éèêàçùâîôûëïüÿœ]/.test(t) || /\b(qui|pourquoi|comment|bonjour|salut)\b/.test(t)) return "fr";
  if (/[а-яё]/.test(t) && !/[іїєґ]/.test(t)) return "ru";
  if (/[іїєґ]/.test(t) || /\b(що|як|привіт|будь ласка)\b/.test(t)) return "uk";
  return "en";
}

export function pickReplyLanguage(msg, text) {
  const tg = (msg?.from?.language_code || "").split("-")[0].toLowerCase();
  const byText = detectLangFromText(text);
  if (byText && tg && byText !== tg) return byText;
  return tg || byText || "en";
}

const dict = {
  uk: {
    hello_name: (name) => `Привіт, ${name}!`,
    how_help: "Як я можу допомогти?",
    senti_tip: "Пиши будь-якою мовою — відповім стисло (в одну sms). Попросиш «детальніше» — розгорну відповідь.",
    disk_on: "📁 Режим диска: ON",
    open_drive_btn: "Відкрити Диск",
    admin_denied: "Доступ заборонено.",
    admin_header: "Адмін-панель (швидка діагностика):",
    need_energy_media: (need, url) => `🔋 Не вистачає енергії для збереження медіа (потрібно ${need}).\nEnergy: ${url}`,
    need_energy_text: (need, url) => `🔋 Не вистачає енергії (потрібно ${need}). Відновлення авто.\nEnergy: ${url}`,
    low_energy_notice: (left, url) => `⚠️ Низький рівень енергії (${left}). Відновиться автоматично. Керування: ${url}`,
    default_reply: "Вибач, зараз не готовий відповісти чітко. Спробуй переформулювати або дай більше контексту.",
  },
  ru: {
    hello_name: (name) => `Привет, ${name}!`,
    how_help: "Как я могу помочь?",
    senti_tip: "Пиши на любом языке — отвечу кратко. Скажешь «подробно» — пришлю развёрнутый ответ.",
    disk_on: "📁 Режим диска: ON",
    open_drive_btn: "Открыть Диск",
    admin_denied: "Доступ запрещён.",
    admin_header: "Админ-панель (быстрая диагностика):",
    need_energy_media: (need, url) => `🔋 Недостаточно энергии для сохранения медиа (нужно ${need}).\nEnergy: ${url}`,
    need_energy_text: (need, url) => `🔋 Недостаточно энергии (нужно ${need}). Восстановится автоматически.\nEnergy: ${url}`,
    low_energy_notice: (left, url) => `⚠️ Низкий уровень энергии (${left}). Восстановится автоматически. Управление: ${url}`,
    default_reply: "Извини, сейчас не могу ответить точно. Попробуй переформулировать или добавь контекст.",
  },
  en: {
    hello_name: (name) => `Hi, ${name}!`,
    how_help: "How can I help?",
    senti_tip: "Use any language — I’ll reply concisely. Say “more details” to expand.",
    disk_on: "📁 Drive mode: ON",
    open_drive_btn: "Open Drive",
    admin_denied: "Access denied.",
    admin_header: "Admin panel (quick diagnostics):",
    need_energy_media: (need, url) => `🔋 Not enough energy to save media (need ${need}).\nEnergy: ${url}`,
    need_energy_text: (need, url) => `🔋 Not enough energy (need ${need}). Auto recovery.\nEnergy: ${url}`,
    low_energy_notice: (left, url) => `⚠️ Low energy (${left}). Will recover automatically. Manage: ${url}`,
    default_reply: "Sorry, I can’t answer precisely right now. Try rephrasing or add more context.",
  },
  de: {
    hello_name: (name) => `Hallo, ${name}!`,
    how_help: "Wie kann ich helfen?",
    senti_tip: "Schreib in jeder Sprache — ich antworte kurz. Für mehr sag „mehr Details“.",
    disk_on: "📁 Laufwerksmodus: AN",
    open_drive_btn: "Drive öffnen",
    admin_denied: "Zugriff verweigert.",
    admin_header: "Admin-Panel (Schnelldiagnose):",
    need_energy_media: (need, url) => `🔋 Nicht genug Energie zum Speichern (benötigt ${need}).\nEnergy: ${url}`,
    need_energy_text: (need, url) => `🔋 Nicht genug Energie (benötigt ${need}). Autom. Wiederherstellung.\nEnergy: ${url}`,
    low_energy_notice: (left, url) => `⚠️ Niedrige Energie (${left}). Erholt sich automatisch. Verwalten: ${url}`,
    default_reply: "Leider gerade keine präzise Antwort. Bitte umformulieren oder mehr Kontext geben.",
  },
  fr: {
    hello_name: (name) => `Salut, ${name} !`,
    how_help: "Comment puis-je aider ?",
    senti_tip: "Écris dans n’importe quelle langue — réponse brève. Dis « plus de détails » pour développer.",
    disk_on: "📁 Mode disque : ACTIVÉ",
    open_drive_btn: "Ouvrir Drive",
    admin_denied: "Accès refusé.",
    admin_header: "Panneau admin (diagnostic rapide) :",
    need_energy_media: (need, url) => `🔋 Pas assez d’énergie pour enregistrer le média (il faut ${need}).\nEnergy : ${url}`,
    need_energy_text: (need, url) => `🔋 Pas assez d’énergie (il faut ${need}). Récupération auto.\nEnergy : ${url}`,
    low_energy_notice: (left, url) => `⚠️ Énergie faible (${left}). Récupération automatique. Gérer : ${url}`,
    default_reply: "Désolé, je ne peux pas répondre précisément pour l’instant. Reformule ou ajoute du contexte.",
  },
};

export function t(lang, key, ...args) {
  const d = dict[lang] || dict.en;
  const val = d[key];
  if (typeof val === "function") return val(...args);
  return val ?? (dict.en[key] || "");
}