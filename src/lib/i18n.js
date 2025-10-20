// src/lib/i18n.js

const DICTS = {
  uk: {
    hello: (name) => `Привіт${name ? `, ${name}` : ""}! Чим можу допомогти?`,
    whoami:
      "✨ Я — Senti, незалежний асистент. Мета — давати точні, корисні відповіді.",
    learn_hint:
      "🧠 Режим навчання.\nНадішліть посилання на статтю/відео або файл (PDF/DOCX/TXT) — додам у чергу навчання.",
    learn_added: "✅ Додано в чергу навчання. Після обробки буду готовий відповідати на запитання.",
    admin_header: "Панель діагностики:",
    btn_open_checklist: "Відкрити Checklist",
    btn_energy: "Керування енергією",
    btn_learn: "Навчання (Learn)",
    main_hint:
      "Використовуйте нижні кнопки або просто напишіть запит. /start — щоб показати клавіатуру.",
  },
  ru: {
    hello: (name) => `Привет${name ? `, ${name}` : ""}! Чем помочь?`,
    whoami:
      "✨ Я — Senti, независимый ассистент. Цель — давать точные и полезные ответы.",
    learn_hint:
      "🧠 Режим обучения.\nПришлите ссылку на статью/видео или файл (PDF/DOCX/TXT) — добавлю в очередь.",
    learn_added: "✅ Добавлено в очередь обучения. После обработки готов отвечать.",
    admin_header: "Панель диагностики:",
    btn_open_checklist: "Открыть Checklist",
    btn_energy: "Управление энергией",
    btn_learn: "Обучение (Learn)",
    main_hint:
      "Пользуйтесь нижними кнопками или просто пишите запрос. /start — чтобы показать клавиатуру.",
  },
  en: {
    hello: (name) => `Hi${name ? `, ${name}` : ""}! How can I help?`,
    whoami:
      "✨ I’m Senti, an independent assistant focused on accurate, useful answers.",
    learn_hint:
      "🧠 Learning mode.\nSend a link to an article/video or a file (PDF/DOCX/TXT) — I’ll queue it for learning.",
    learn_added:
      "✅ Added to the learning queue. I’ll be ready to answer questions after processing.",
    admin_header: "Diagnostics panel:",
    btn_open_checklist: "Open Checklist",
    btn_energy: "Energy control",
    btn_learn: "Learning (Learn)",
    main_hint:
      "Use the bottom buttons or just type. /start — to show the keyboard.",
  },
  de: {
    hello: (name) => `Hallo${name ? `, ${name}` : ""}! Womit kann ich helfen?`,
    whoami:
      "✨ Ich bin Senti, ein unabhängiger Assistent. Ziel: präzise, hilfreiche Antworten.",
    learn_hint:
      "🧠 Lernmodus.\nSende einen Link zu einem Artikel/Video oder eine Datei (PDF/DOCX/TXT) — ich stelle sie in die Warteschlange.",
    learn_added:
      "✅ Zur Lernwarteschlange hinzugefügt. Nach der Verarbeitung beantworte ich Fragen.",
    admin_header: "Diagnosepanel:",
    btn_open_checklist: "Checklist öffnen",
    btn_energy: "Energieverwaltung",
    btn_learn: "Lernen (Learn)",
    main_hint:
      "Nutze die unteren Buttons oder schreibe einfach. /start — um die Tastatur zu zeigen.",
  },
  fr: {
    hello: (name) => `Salut${name ? `, ${name}` : ""} ! Comment puis-je aider ?`,
    whoami:
      "✨ Je suis Senti, un assistant indépendant, focalisé sur des réponses précises et utiles.",
    learn_hint:
      "🧠 Mode apprentissage.\nEnvoie un lien vers un article/vidéo ou un fichier (PDF/DOCX/TXT) — je l’ajouterai à la file.",
    learn_added:
      "✅ Ajouté à la file d’apprentissage. Je pourrai répondre après traitement.",
    admin_header: "Panneau de diagnostic :",
    btn_open_checklist: "Ouvrir la Checklist",
    btn_energy: "Gestion d’énergie",
    btn_learn: "Apprentissage (Learn)",
    main_hint:
      "Utilise les boutons ci-dessous ou écris simplement. /start — pour afficher le clavier.",
  },
};
function langFromTg(tgUserLang) {
  if (!tgUserLang) return "uk";
  const c = tgUserLang.toLowerCase();
  if (c.startsWith("uk")) return "uk";
  if (c.startsWith("ru")) return "ru";
  if (c.startsWith("de")) return "de";
  if (c.startsWith("fr")) return "fr";
  if (c.startsWith("en")) return "en";
  return "uk";
}

export function pickLang(update) {
  const from = update?.message?.from || update?.callback_query?.from;
  return langFromTg(from?.language_code);
}

export function t(lang, key, ...args) {
  const L = DICTS[lang] || DICTS.uk;
  const val = L[key] ?? DICTS.uk[key] ?? key;
  return typeof val === "function" ? val(...args) : val;
}

