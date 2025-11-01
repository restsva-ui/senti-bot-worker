// src/lib/voiceRouter.js
// Вибір TTS-голосу за мовою + евристика визначення мови з тексту.

export function guessLangFromText(s = "") {
  const t = String(s || "");
  if (/[їєіґЇЄІҐ]/.test(t)) return "uk";
  if (/[А-Яа-яЁёІіЇїЄєҐґ]/.test(t)) return "ru";     // кирилиця → ru (як запасний для RU/UA)
  if (/[ÄÖÜäöüß]/.test(t) || /\b(der|die|das|und|nicht|ich|mit|für)\b/i.test(t)) return "de";
  if (/[àâçéèêëîïôùûüÿœæ]/i.test(t) || /\b(le|la|les|des|une|et|pour|avec)\b/i.test(t)) return "fr";
  return "en";
}

export function normalizeLangCode(x = "") {
  const v = String(x || "").toLowerCase();
  if (v.startsWith("uk")) return "uk";
  if (v.startsWith("ru")) return "ru";
  if (v.startsWith("en")) return "en";
  if (v.startsWith("de")) return "de";
  if (v.startsWith("fr")) return "fr";
  return "en";
}

/** Обрати voice з env за мовою. Підтримуються:
 * VOICE_SPEAKER_UK, _RU, _EN, _DE, _FR, або дефолт VOICE_SPEAKER.
 */
export function resolveSpeaker(env = {}, langHint = "", text = "") {
  const byText = guessLangFromText(text);
  const lang = normalizeLangCode(langHint || byText);

  const map = {
    uk: env.VOICE_SPEAKER_UK,
    ru: env.VOICE_SPEAKER_RU,
    en: env.VOICE_SPEAKER_EN,
    de: env.VOICE_SPEAKER_DE,
    fr: env.VOICE_SPEAKER_FR,
  };

  let v = map[lang];
  if (!v || !String(v).trim()) v = env.VOICE_SPEAKER;
  return String(v || "angus");
}

// (Опціонально) обгортка у SSML <lang> — якщо TTS провайдер це підтримує.
export function wrapSsmlByLang(text = "", lang = "en") {
  const tag = {
    uk: "uk-UA", ru: "ru-RU", en: "en-US", de: "de-DE", fr: "fr-FR",
  }[normalizeLangCode(lang)] || "en-US";
  return `<voice name="${tag}"><lang xml:lang="${tag}">${escapeXml(text)}</lang></voice>`;
}

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}