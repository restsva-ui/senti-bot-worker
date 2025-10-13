// src/lib/i18n.js
// Multilang helper: language storage + texts + robust detection

export const SUP_LANGS = ["uk", "ru", "de", "en", "fr"];
const LANG_KEY = (uid) => `lang:${uid}`;

const ensureState = (env) => {
  if (!env.STATE_KV) throw new Error("STATE_KV binding missing");
  return env.STATE_KV;
};

export function normTgLang(code = "") {
  const c = String(code || "").toLowerCase();
  if (c.startsWith("uk")) return "uk";
  if (c.startsWith("ru")) return "ru";
  if (c.startsWith("de")) return "de";
  if (c.startsWith("fr")) return "fr";
  return "en";
}

// ---- language detection -----------------------------------------------------
function scoreVotes(text = "") {
  const t = String(text).toLowerCase();

  // unique letters -> strong hints
  const strong = {
    uk: /[їєґі]/i.test(t),
    ru: /[ёыэъ]/i.test(t),
    de: /[äöüß]/i.test(t),
    fr: /[àâçéèêëîïôûùüÿœæ]/i.test(t),
  };

  // stopwords (короткі, але сигналні). ваги підібрані практично
  const votes = { uk: 0, ru: 0, de: 0, en: 0, fr: 0 };
  const bump = (k, n = 1) => (votes[k] += n);

  // uk
  if (/\b(як|що|це|та|але|тут|привіт|дякую|будь ласка|прошу)\b/.test(t)) bump("uk", 2);

  // ru
  if (/\b(как|что|это|этот|ну|привет|помоги|пожалуйста|я)\b/.test(t)) bump("ru", 2);

  // de
  if (/\b(der|die|das|und|ist|nicht|ich|heute|bitte|danke)\b/.test(t)) bump("de", 2);

  // en
  if (/\b(the|and|is|are|you|i|what|how|please|thanks)\b/.test(t)) bump("en", 2);

  // fr
  if (/\b(le|la|les|et|est|pas|je|tu|aujourd'hui|s'il vous plaît|merci)\b/.test(t)) bump("fr", 2);

  // tiny bias to latin-only text -> en
  if (/^[\x00-\x7F\s.,!?:'"()\-]+$/.test(t)) bump("en", 1);

  // pick best
  let best = "en", max = -1;
  for (const k of SUP_LANGS) {
    if (votes[k] > max) { max = votes[k]; best = k; }
  }

  // strong signal wins regardless of votes
  const strongLang = Object.entries(strong).find(([, v]) => v)?.[0] || null;
  return {
    lang: strongLang || best,
    score: strongLang ? 99 : max,   // 99 = force switch
    strong: !!strongLang,
  };
}

function containsDontUnderstand(text = "") {
  const t = text.toLowerCase();
  return (
    /не понимаю|не розумію|i don't understand|je ne comprends pas|ich verstehe (es|das) nicht/.test(t)
  );
}

/**
 * Detect language from message. Returns {lang, score, strong}.
 */
export function detectLangFromText(s = "", fallback = "en") {
  if (!s || s.trim().length < 2) return { lang: fallback, score: 0, strong: false };
  return scoreVotes(s);
}

/**
 * Decide and persist user language.
 * Strategy:
 *  - start from saved or Telegram code
 *  - detect on each message
 *  - switch only if strong OR score >= 2 AND different from current
 *  - if phrase like "I don't understand this language" is present — switch to message lang
 */
export async function getUserLang(env, userId, tgCode, lastText = "") {
  const kv = ensureState(env);
  const key = LANG_KEY(userId);
  const saved = await kv.get(key);
  let lang = saved || normTgLang(tgCode);

  if (lastText && lastText.length >= 2) {
    const det = detectLangFromText(lastText, lang);
    const wantSwitch =
      det.strong || (det.lang !== lang && det.score >= 2) || containsDontUnderstand(lastText);

    if (SUP_LANGS.includes(det.lang) && wantSwitch) {
      lang = det.lang;
      await kv.put(key, lang, { expirationTtl: 60 * 60 * 24 * 90 }); // 90 days
    }
  }
  return SUP_LANGS.includes(lang) ? lang : "en";
}

// ---- translations -----------------------------------------------------------
export const TR = {
  // дружнє, коротке вітання після /start
  hello: {
    uk: "Привіт! Я Senti 🤖 Готовий допомогти.",
    ru: "Привет! Я Senti 🤖 Готов помочь.",
    de: "Hi! Ich bin Senti 🤖 — bereit zu helfen.",
    en: "Hey! I’m Senti 🤖—ready to help.",
    fr: "Salut ! Je suis Senti 🤖, prêt à aider.",
  },

  // підказка для /ai (коли пустий запит)
  ai_usage: {
    uk: "✍️ Напиши запит після команди /ai. Напр.:\n/ai Скільки буде 2+2?",
    ru: "✍️ Напиши запрос после команды /ai. Например:\n/ai Сколько будет 2+2?",
    de: "✍️ Schreib deine Frage nach /ai. Z. B.:\n/ai Wieviel ist 2+2?",
    en: "✍️ Type your question after /ai. E.g.:\n/ai What’s 2+2?",
    fr: "✍️ Écris ta question après /ai. Par ex. :\n/ai 2+2 = ?",
  },

  // енергія: не вистачає
  energy_not_enough: {
    uk: (need, links) =>
      `🔋 Не вистачає енергії (потрібно ${need}). Вона відновлюється автоматично.\nКерування:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`,
    ru: (need, links) =>
      `🔋 Недостаточно энергии (нужно ${need}). Она восстанавливается автоматически.\nУправление:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`,
    de: (need, links) =>
      `🔋 Nicht genug Energie (benötigt ${need}). Sie lädt sich automatisch auf.\nVerwalten:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`,
    en: (need, links) =>
      `🔋 Not enough energy (need ${need}). It refills automatically.\nManage:\n• Energy: ${links.energy}\n• Checklist: ${links.checklist}`,
    fr: (need, links) =>
      `🔋 Pas assez d’énergie (il faut ${need}). Elle se recharge automatiquement.\nGérer :\n• Energy : ${links.energy}\n• Checklist : ${links.checklist}`,
  },

  // енергія: низький рівень
  energy_low_hint: {
    uk: (cur, link) => `⚠️ Низький рівень енергії (${cur}). Відновиться автоматично. Керування: ${link}`,
    ru: (cur, link) => `⚠️ Низкий уровень энергии (${cur}). Восстановится автоматически. Управление: ${link}`,
    de: (cur, link) => `⚠️ Niedriger Energiewert (${cur}). Lädt sich automatisch auf. Verwalten: ${link}`,
    en: (cur, link) => `⚠️ Low energy (${cur}). It will refill automatically. Manage: ${link}`,
    fr: (cur, link) => `⚠️ Énergie faible (${cur}). Recharge automatique. Gérer : ${link}`,
  },

  // Drive авторизація (єдина текстова підказка; самі статуси "on/off" ми не показуємо)
  drive_auth: {
    uk: (url) => `Щоб зберігати у свій Google Drive — дозволь доступ:\n${url}\n\nПотім натисни «📁 Drive» ще раз.`,
    ru: (url) => `Чтобы сохранять в свой Google Drive — дай доступ:\n${url}\n\nПотом нажми «📁 Drive» ещё раз.`,
    de: (url) => `Zum Speichern auf deinem Google Drive: bitte Zugriff erlauben:\n${url}\n\nDann drücke nochmal «📁 Drive».`,
    en: (url) => `To save to your Google Drive, grant access first:\n${url}\n\nThen tap “📁 Drive” again.`,
    fr: (url) => `Pour enregistrer sur ton Google Drive, accorde d’abord l’accès :\n${url}\n\nPuis appuie encore sur « 📁 Drive ».`,
  },

  // ці ключі лишаємо пустими — у UI нічого не виводимо
  drive_on:  { uk: "", ru: "", de: "", en: "", fr: "" },
  drive_off: { uk: "", ru: "", de: "", en: "", fr: "" },

  // підтвердження збереження файлу на Drive
  saved_to_drive: {
    uk: (name) => `✅ Збережено на твоєму диску: ${name}`,
    ru: (name) => `✅ Сохранено на твоём диске: ${name}`,
    de: (name) => `✅ Auf deinem Drive gespeichert: ${name}`,
    en: (name) => `✅ Saved to your Drive: ${name}`,
    fr: (name) => `✅ Enregistré sur ton Drive : ${name}`,
  },

  // посилання на Checklist (використовується в адмін-меню)
  checklist_link: {
    uk: (link) => `📋 Чеклист (HTML):\n${link}`,
    ru: (link) => `📋 Чеклист (HTML):\n${link}`,
    de: (link) => `📋 Checkliste (HTML):\n${link}`,
    en: (link) => `📋 Checklist (HTML):\n${link}`,
    fr: (link) => `📋 Checklist (HTML) :\n${link}`,
  },

  // текстове адмін-меню (про всяк випадок — якщо потрібно поряд з інлайном)
  admin_menu: {
    uk: (cl, repo, hook) => `🛠 Адмін-меню\n\n• Чеклист: ${cl}\n• Repo: ${repo}\n• Вебхук GET: ${hook}`,
    ru: (cl, repo, hook) => `🛠 Админ-меню\n\n• Чеклист: ${cl}\n• Repo: ${repo}\n• Webhook GET: ${hook}`,
    de: (cl, repo, hook) => `🛠 Admin-Menü\n\n• Checkliste: ${cl}\n• Repo: ${repo}\n• Webhook GET: ${hook}`,
    en: (cl, repo, hook) => `🛠 Admin menu\n\n• Checklist: ${cl}\n• Repo: ${repo}\n• Webhook GET: ${hook}`,
    fr: (cl, repo, hook) => `🛠 Menu admin\n\n• Checklist : ${cl}\n• Repo : ${repo}\n• Webhook GET : ${hook}`,
  },

  // довідка по /tone
  tone_help: {
    uk: () => `Налаштування тону:\n/tone auto — авто\n/tone friendly|casual|playful|concise|professional|formal|empathetic|neutral`,
    ru: () => `Настройка тона:\n/tone auto — авто\n/tone friendly|casual|playful|concise|professional|formal|empathetic|neutral`,
    de: () => `Ton-Einstellung:\n/tone auto — automatisch\n/tone friendly|casual|playful|concise|professional|formal|empathetic|neutral`,
    en: () => `Tone settings:\n/tone auto\n/tone friendly|casual|playful|concise|professional|formal|empathetic|neutral`,
    fr: () => `Réglage du ton :\n/tone auto\n/tone friendly|casual|playful|concise|professional|formal|empathetic|neutral`,
  },

  // підтвердження встановлення /tone
  tone_set_ok: {
    uk: (v) => `✅ Тон встановлено: ${v}`,
    ru: (v) => `✅ Тон установлен: ${v}`,
    de: (v) => `✅ Ton gesetzt: ${v}`,
    en: (v) => `✅ Tone set: ${v}`,
    fr: (v) => `✅ Ton défini : ${v}`,
  },

  // показати поточний /tone
  tone_current: {
    uk: (mode, value, last) => `Тон: режим=${mode}, значення=${value || "—"}, авто останній=${last || "—"}`,
    ru: (mode, value, last) => `Тон: режим=${mode}, значение=${value || "—"}, авто последний=${last || "—"}`,
    de: (mode, value, last) => `Ton: Modus=${mode}, Wert=${value || "—"}, Auto zuletzt=${last || "—"}`,
    en: (mode, value, last) => `Tone: mode=${mode}, value=${value || "—"}, auto last=${last || "—"}`,
    fr: (mode, value, last) => `Ton : mode=${mode}, valeur=${value || "—"}, auto dernier=${last || "—"}`,
  },

  // загальна помилка
  generic_error: {
    uk: (e) => `❌ Помилка: ${e}`,
    ru: (e) => `❌ Ошибка: ${e}`,
    de: (e) => `❌ Fehler: ${e}`,
    en: (e) => `❌ Error: ${e}`,
    fr: (e) => `❌ Erreur : ${e}`,
  },
};

export const tr = (lang, key, ...args) => {
  const v = TR[key]?.[lang] ?? TR[key]?.en;
  return typeof v === "function" ? v(...args) : v;
};