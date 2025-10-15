// src/lib/i18n.js
// Локалізація + акуратне визначення мови з тексту/TG із "впевненістю".

function score(pattern, text) { return (text.match(pattern) || []).length; }

export function detectLangFromText(raw = "") {
  const s = String(raw || "").toLowerCase().trim();

  // Порожній текст / команди — невпевненість 0
  if (!s || /^\/[\w@]+$/.test(s)) return { lang: null, conf: 0 };

  // латиниця
  const deHints = score(/\b(der|die|das|und|ist|bist|wer|nicht|hallo)\b/g, s) + score(/[äöüß]/g, s);
  const frHints = score(/\b(qui|pourquoi|comment|bonjour|salut)\b/g, s) + score(/[éèêàçùâîôûëïüÿœ]/g, s);
  const enHints = score(/\b(what|who|how|hello|hi|are|is|the)\b/g, s);

  // кирилиця
  const hasCyr = /[а-яёіїєґ]/i.test(s);
  const ukHints = hasCyr ? score(/[іїєґ]/g, s) + score(/\b(що|як|будь ласка|привіт)\b/g, s) : 0;
  const ruHints = hasCyr ? score(/[ёъыэ]/g, s) + score(/\b(что|как|привет|пожалуйста)\b/g, s) : 0;

  // підрахунок
  const candidates = [
    { lang: "de", conf: deHints },
    { lang: "fr", conf: frHints },
    { lang: "uk", conf: ukHints },
    { lang: "ru", conf: ruHints },
    { lang: "en", conf: enHints }
  ].sort((a,b)=>b.conf-a.conf);

  const best = candidates[0];
  // нормалізуємо у [0..1] (5 і більше — дуже впевнено)
  const conf = Math.min(best.conf / 5, 1);
  return { lang: best.conf > 0 ? best.lang : null, conf };
}

export function pickReplyLanguage(msg, text) {
  const tg = (msg?.from?.language_code || "").split("-")[0].toLowerCase(); // пріоритет TG
  const { lang: byText, conf } = detectLangFromText(text);

  // Якщо TG відомий — тримаємось його, окрім дуже явного іншого тексту
  if (tg) {
    if (byText && byText !== tg && conf >= 0.7) return byText; // явна зміна мови
    return tg;
  }
  // Нема TG — довіряємо тексту, але тільки якщо є хоч якась упевненість
  return byText || "en";
}

const dict = {
  uk: {
    hello_name: (n) => `Привіт, ${n}!`,
    how_help: "Як я можу допомогти?",
    senti_tip: "Пиши будь-якою мовою — відповім стисло (одна смс). Скажеш «детальніше» — розгорну.",
    disk_on: "📁 Режим диска: ON",
    open_drive_btn: "Відкрити Диск",
    admin_denied: "Доступ заборонено.",
    admin_header: "Адмін-панель (швидка діагностика):",
    need_energy_media: (need, url) => `🔋 Не вистачає енергії для збереження медіа (потрібно ${need}).\nEnergy: ${url}`,
    need_energy_text: (need, url) => `🔋 Не вистачає енергії (потрібно ${need}). Відновиться автоматично.\nEnergy: ${url}`,
    low_energy_notice: (left, url) => `⚠️ Низький рівень енергії (${left}). Відновиться автоматично. Керування: ${url}`,
    default_reply: "Вибач, поки не можу відповісти точно. Спробуй переформулювати або дай більше контексту.",
  },
  ru: {
    hello_name: (n) => `Привет, ${n}!`,
    how_help: "Как я могу помочь?",
    senti_tip: "Пиши на любом языке — отвечу кратко. Скажешь «подробно» — раскрою ответ.",
    disk_on: "📁 Режим диска: ON",
    open_drive_btn: "Открыть Диск",
    admin_denied: "Доступ запрещён.",
    admin_header: "Админ-панель (быстрая диагностика):",
    need_energy_media: (need, url) => `🔋 Недостаточно энергии для сохранения медиа (нужно ${need}).\nEnergy: ${url}`,
    need_energy_text: (need, url) => `🔋 Недостаточно энергии (нужно ${need}). Восстановится автоматически.\nEnergy: ${url}`,
    low_energy_notice: (left, url) => `⚠️ Низкий уровень энергии (${left}). Восстановится автоматически. Управление: ${url}`,
    default_reply: "Извини, пока не могу ответить точно. Попробуй переформулировать или добавь контекст.",
  },
  en: {
    hello_name: (n) => `Hi, ${n}!`,
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
    hello_name: (n) => `Hallo, ${n}!`,
    how_help: "Wie kann ich helfen?",
    senti_tip: "Schreib in jeder Sprache — ich antworte kurz. Sag „mehr Details“ zum Ausklappen.",
    disk_on: "📁 Laufwerksmodus: AN",
    open_drive_btn: "Drive öffnen",
    admin_denied: "Zugriff verweigert.",
    admin_header: "Admin-Panel (Schnelldiagnose):",
    need_energy_media: (need, url) => `🔋 Nicht genug Energie zum Speichern (benötigt ${need}).\nEnergy: ${url}`,
    need_energy_text: (need, url) => `🔋 Nicht genug Energie (benötigt ${need}). Automatische Wiederherstellung.\nEnergy: ${url}`,
    low_energy_notice: (left, url) => `⚠️ Niedrige Energie (${left}). Erholt sich automatisch. Verwalten: ${url}`,
    default_reply: "Gerade keine präzise Antwort möglich. Bitte umformulieren oder mehr Kontext geben.",
  },
  fr: {
    hello_name: (n) => `Salut, ${n} !`,
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