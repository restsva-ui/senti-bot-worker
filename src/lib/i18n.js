// src/lib/i18n.js
// --- simple i18n helper for webhook ---

const SUP_LANGS = ["uk", "ru", "de", "en", "fr"];

function normTgLang(code = "") {
  const c = String(code || "").toLowerCase();
  if (c.startsWith("uk")) return "uk";
  if (c.startsWith("ru")) return "ru";
  if (c.startsWith("de")) return "de";
  if (c.startsWith("fr")) return "fr";
  return "en";
}

function detectLangFromText(s = "", fallback = "en") {
  const t = String(s).toLowerCase();
  if (/[їєґі]/.test(t)) return "uk";
  if (/[ёыэъ]/.test(t)) return "ru";
  if (/[äöüß]/.test(t)) return "de";
  if (/[àâçéèêëîïôûùüÿœæ]/.test(t)) return "fr";
  return fallback;
}

async function getUserLang(env, userId, tgCode, lastText = "") {
  const kv = env.STATE_KV;
  const key = `lang:${userId}`;
  const saved = kv ? await kv.get(key) : null;
  let lang = saved || normTgLang(tgCode);
  const detected = detectLangFromText(lastText, lang);
  if (SUP_LANGS.includes(detected) && detected !== lang) {
    lang = detected;
    if (kv) await kv.put(key, lang, { expirationTtl: 60 * 60 * 24 * 90 });
  }
  return lang;
}

// mini dictionary
const TR = {
  hello: { uk: "Привіт! Я Senti 🤖", en: "Hi! I'm Senti 🤖" },
  generic_error: { uk: (e) => `❌ Помилка: ${e}`, en: (e) => `❌ Error: ${e}` },
  ai_usage: { uk: "✍️ Напиши /ai <запит>", en: "✍️ Type /ai <query>" },
};

function tr(lang, key, ...args) {
  const val = TR[key]?.[lang] ?? TR[key]?.en ?? key;
  return typeof val === "function" ? val(...args) : val;
}

export { getUserLang, tr };