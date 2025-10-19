// src/lib/i18n.js
const DICTS = {
  uk: {
    hello: (name) => `Привіт${name ? `, ${name}` : ""}! Чим можу допомогти?`,
    whoami: "✨ Я існую як незалежний помічник. Моя мета — надавати вам інформацію та допомогу.",
    learn_hint: "🧠 Режим навчання.\nНадішліть мені посилання на статтю/відео або файл (PDF, DOCX, TXT) — додам у чергу навчання.",
    learn_added: "✅ Додано в чергу навчання. Опрацюю у фоні та буду готовий відповідати на запитання.",
    admin_header: "Admin panel (quick diagnostics):",
    btn_open_checklist: "Відкрити Checklist",
    btn_energy: "Керування енергією",
    btn_learn: "Навчання (Learn)",
  },
  en: {
    hello: (name) => `Hi${name ? `, ${name}` : ""}! How can I help?`,
    whoami: "✨ I am an independent assistant. My purpose is to help you with information and tasks.",
    learn_hint: "🧠 Learning mode.\nSend me a link to an article/video or a file (PDF, DOCX, TXT). I’ll queue it for learning.",
    learn_added: "✅ Added to learning queue. I’ll process it in the background and be ready to answer questions.",
    admin_header: "Admin panel (quick diagnostics):",
    btn_open_checklist: "Open Checklist",
    btn_energy: "Energy controls",
    btn_learn: "Learning (Learn)",
  },
  ru: {
    hello: (name) => `Привет${name ? `, ${name}` : ""}! Чем могу помочь?`,
    whoami: "✨ Я независимый помощник. Моя цель — помогать вам с информацией и задачами.",
    learn_hint: "🧠 Режим обучения.\nПришлите ссылку на статью/видео или файл (PDF, DOCX, TXT) — добавлю в очередь обучения.",
    learn_added: "✅ Добавлено в очередь обучения. Обработаю в фоне и буду готов отвечать на вопросы.",
    admin_header: "Admin panel (quick diagnostics):",
    btn_open_checklist: "Открыть Checklist",
    btn_energy: "Управление энергией",
    btn_learn: "Обучение (Learn)",
  },
  de: {
    hello: (name) => `Hallo${name ? `, ${name}` : ""}! Wobei kann ich helfen?`,
    whoami: "✨ Ich bin ein unabhängiger Assistent. Mein Ziel ist, mit Information und Aufgaben zu helfen.",
    learn_hint: "🧠 Lernmodus.\nSende mir einen Link (Artikel/Video) oder eine Datei (PDF, DOCX, TXT). Ich stelle es in die Lernwarteschlange.",
    learn_added: "✅ Zur Lernwarteschlange hinzugefügt. Ich verarbeite es im Hintergrund und beantworte später Fragen.",
    admin_header: "Admin panel (quick diagnostics):",
    btn_open_checklist: "Checklist öffnen",
    btn_energy: "Energieverwaltung",
    btn_learn: "Lernen (Learn)",
  },
};

export function pickLang(code) {
  const c = String(code || "").toLowerCase();
  if (c.startsWith("uk")) return "uk";
  if (c.startsWith("ru")) return "ru";
  if (c.startsWith("de")) return "de";
  if (c.startsWith("en")) return "en";
  return "en";
}

export function t(lang, key, ...args) {
  const L = DICTS[lang] || DICTS.en;
  const val = L[key] ?? DICTS.en[key] ?? key;
  return typeof val === "function" ? val(...args) : val;
}

/* ---- Сумісність з вашими імпортами ----
   У коді зустрічаються імпорти pickReplyLanguage/detectFromText.
   Додаємо їх як аліаси, щоб деплой не ламався. */
export function pickReplyLanguage(update) {
  const code =
    update?.message?.from?.language_code ||
    update?.callback_query?.from?.language_code ||
    "en";
  return pickLang(code);
}

// Дуже проста детекція за текстом (fallback). За потреби замініть на реальну.
export function detectFromText(text = "") {
  const s = (text || "").toLowerCase();
  if (/[а-яіїєґ]/.test(s)) return "uk";
  if (/[а-яё]/.test(s)) return "ru";
  if (/[a-z]/.test(s)) return "en";
  return "en";
} 
