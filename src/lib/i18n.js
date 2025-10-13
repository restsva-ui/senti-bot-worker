// src/lib/i18n.js
// Легкий I18N для Senti: авто-вибір мови + розмовний стиль.
// Підтримка: uk, ru, en (US), de, fr.

const SUPPORTED = ["uk", "ru", "en", "de", "fr"];

const NORM = (code = "") => {
  const s = String(code).toLowerCase();
  if (s.startsWith("uk")) return "uk";
  if (s.startsWith("ru")) return "ru";
  if (s.startsWith("en")) return "en";
  if (s.startsWith("de")) return "de";
  if (s.startsWith("fr")) return "fr";
  return "";
};

// Простенька детекція за алфавітом/токенами (без зовн. API)
export function detectLangFromText(text = "") {
  const s = String(text || "");
  if (!s) return "";
  const cyr = /[а-яёіїєґ]/i.test(s);
  const ukHints = /(будь ласка|дякую|привіт|будь-що|темн(а|у) тему|ї)/i.test(s);
  const ruHints = /(пожалуйста|спасибо|привет|темн(ая|ую) тему|ё|ы|э)/i.test(s);
  if (cyr && ukHints) return "uk";
  if (cyr && ruHints) return "ru";
  if (/[äöüß]/i.test(s)) return "de";
  if (/[àâçéèêëîïôûùüÿœ]/i.test(s)) return "fr";
  if (/[a-z]/i.test(s)) return "en";
  return "";
}

// KV збереження мови чату
const LANG_KEY = (chatId) => `lang:${chatId}`;
const ensureState = (env) => {
  if (!env.STATE_KV) throw new Error("STATE_KV missing for i18n");
  return env.STATE_KV;
};

export async function getChatLang(env, chatId) {
  try { return await ensureState(env).get(LANG_KEY(chatId)) || ""; } catch { return ""; }
}
export async function setChatLang(env, chatId, lang) {
  try { await ensureState(env).put(LANG_KEY(chatId), lang, { expirationTtl: 60*60*24*90 }); } catch {}
}

// Основний вибір мови:
// 1) якщо користувач уже має збережену — беремо її,
// 2) якщо повідомлення явно іншою мовою — перемикаємося,
// 3) інакше — Telegram language_code, далі 'uk' як дефолт.
export async function decideLang(env, chatId, tgLangCode, incomingText) {
  const saved = await getChatLang(env, chatId);
  const detected = detectLangFromText(incomingText);
  if (saved && detected && detected !== saved) {
    await setChatLang(env, chatId, detected); 
    return detected;
  }
  if (saved) return saved;
  const normTg = NORM(tgLangCode);
  const chosen = detected || normTg || "uk";
  await setChatLang(env, chatId, chosen);
  return chosen;
}

// Розмовний стиль як системний хінт
export function styleHint(lang) {
  switch (lang) {
    case "ru": return "Отвечай по-разговорному, дружелюбно и просто. Не злоупотребляй эмодзи. Не начинай каждый раз с приветствия, если диалог уже идёт.";
    case "en": return "Reply in a casual, friendly tone. Keep it concise, avoid corporate language. Don't re-greet if the chat is already ongoing.";
    case "de": return "Antworte locker, freundlich und knapp. Kein Amtsdeutsch. Kein erneutes Begrüßen, wenn das Gespräch schon läuft.";
    case "fr": return "Réponds de façon naturelle et amicale, en restant concise. Pas de ton administratif. Pas de nouveaux salutations si la discussion est déjà engagée.";
    default:   return "Відповідай розмовно, дружньо й просто. Менше канцеляризмів. Не вітайся щоразу, якщо діалог уже триває.";
  }
}

// Невеликий словничок службових фраз (те, що часто показуємо з коду)
const STRINGS = {
  start: {
    uk: "Привіт! Я Senti 🤖 Готовий допомогти.",
    ru: "Привет! Я Senti 🤖 Готов помочь.",
    en: "Hi! I'm Senti 🤖 Ready to help.",
    de: "Hi! Ich bin Senti 🤖 Bereit zu helfen.",
    fr: "Salut ! Je suis Senti 🤖 Prêt à aider.",
  },
  diskOn: {
    uk: "📁 Режим диска: ON. Надсилай файли — збережу на твій Google Drive.",
    ru: "📁 Режим диска: ON. Присылай файлы — сохраню на твой Google Drive.",
    en: "📁 Drive mode: ON. Send files — I’ll save them to your Google Drive.",
    de: "📁 Laufwerksmodus: AN. Sende Dateien — ich speichere sie in deinem Google Drive.",
    fr: "📁 Mode Drive : activé. Envoie des fichiers — je les enregistrerai sur ton Google Drive.",
  },
  diskOff: {
    uk: "Режим диска вимкнено. Повертаємось до чату Senti.",
    ru: "Режим диска отключён. Возвращаемся к чату Senti.",
    en: "Drive mode off. Back to Senti chat.",
    de: "Laufwerksmodus aus. Zurück zum Senti-Chat.",
    fr: "Mode Drive désactivé. Retour au chat Senti.",
  },
  needAuth: {
    uk: (url)=>`Щоб зберігати у свій Google Drive — дай доступ:\n${url}\nПотім натисни «Google Drive» ще раз.`,
    ru: (url)=>`Чтобы сохранять в Google Drive — дай доступ:\n${url}\nПотом нажми «Google Drive» ещё раз.`,
    en: (url)=>`To save to Google Drive, please authorize:\n${url}\nThen press “Google Drive” again.`,
    de: (url)=>`Um in Google Drive zu speichern, erteile bitte Zugriff:\n${url}\nDann drücke erneut „Google Drive“.`,
    fr: (url)=>`Pour enregistrer dans Google Drive, autorise l’accès :\n${url}\nPuis appuie encore sur « Google Drive ».`,
  },
  noEnergyText: {
    uk: (need, link)=>`🔋 Не вистачає енергії (потрібно ${need}). Вона відновлюється автоматично.\nКерування: ${link}`,
    ru: (need, link)=>`🔋 Недостаточно энергии (нужно ${need}). Она восстанавливается автоматически.\nУправление: ${link}`,
    en: (need, link)=>`🔋 Not enough energy (need ${need}). It regenerates automatically.\nManage: ${link}`,
    de: (need, link)=>`🔋 Nicht genug Energie (benötigt ${need}). Sie regeneriert automatisch.\nVerwaltung: ${link}`,
    fr: (need, link)=>`🔋 Pas assez d’énergie (il faut ${need}). Elle se régénère automatiquement.\nGérer : ${link}`,
  },
  lowEnergyTail: {
    uk: (cur, link)=>`\n\n⚠️ Низький рівень енергії (${cur}). Керування: ${link}`,
    ru: (cur, link)=>`\n\n⚠️ Низкий уровень энергии (${cur}). Управление: ${link}`,
    en: (cur, link)=>`\n\n⚠️ Low energy (${cur}). Manage: ${link}`,
    de: (cur, link)=>`\n\n⚠️ Wenig Energie (${cur}). Verwaltung: ${link}`,
    fr: (cur, link)=>`\n\n⚠️ Énergie faible (${cur}). Gérer : ${link}`,
  },
};

export function t(lang, key, ...args) {
  const L = SUPPORTED.includes(lang) ? lang : "uk";
  const val = STRINGS[key]?.[L];
  if (typeof val === "function") return val(...args);
  return val || "";
}