// src/lib/i18n.js
// Мінімальна i18n із ключами, які потрібні для стартового вітання.

const dict = {
  uk: {
    hello_name: (name) => `Привіт, ${name}! Я Senti. Пиши будь-якою мовою — відповім коротко й по суті.`,
    senti_tip: "Щоб отримати більше деталей — напиши: «більше деталей». Для зображення просто надішли фото.",
    how_help: "Чим допомогти?",
  },
  ru: {
    hello_name: (name) => `Привет, ${name}! Я Senti. Пиши на любом языке — отвечу кратко и по сути.`,
    senti_tip: "Чтобы получить больше деталей — напиши: «больше деталей». Для изображения просто пришли фото.",
    how_help: "Чем помочь?",
  },
  en: {
    hello_name: (name) => `Hi, ${name}! I'm Senti. Use any language — I'll reply concisely.`,
    senti_tip: "Say “more details” to expand. Send a photo for vision.",
    how_help: "How can I help?",
  },
};

export function t(lang = "uk", key, arg) {
  const pack = dict[lang] || dict.uk;
  const val = pack[key];
  if (typeof val === "function") return val(arg);
  return val || (dict.en[key] ? (typeof dict.en[key] === "function" ? dict.en[key](arg) : dict.en[key]) : key);
}