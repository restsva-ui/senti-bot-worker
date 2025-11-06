// src/lib/landmarkDetect.js
// Виявлення відомих локацій у тексті опису фото + форматування під Telegram (HTML).

const KNOWN_LANDMARKS = [
  { names: ["ейфелева вежа", "eiffel tower", "tour eiffel"], query: "Eiffel Tower, Paris" },
  { names: ["біг-бен", "big ben", "elizabeth tower"], query: "Big Ben, London" },
  { names: ["колізей", "colosseum"], query: "Colosseum, Rome" },
  { names: ["статуя свободи", "statue of liberty"], query: "Statue of Liberty, New York" },
  { names: ["софія київська", "софійський собор", "saint sophia cathedral", "st sophia cathedral kyiv"], query: "Saint Sophia Cathedral, Kyiv" },
  { names: ["києво-печерська лавра", "печерська лавра", "kyiv pechersk lavra"], query: "Kyiv Pechersk Lavra" },
  { names: ["львівська ратуша", "lviv town hall"], query: "Lviv Town Hall" },
  { names: ["хрещатик", "khreschatyk", "krechtchatyk"], query: "Khreschatyk, Kyiv" },
  { names: ["майдан незалежності", "maidan nezalezhnosti", "independence square kyiv"], query: "Maidan Nezalezhnosti, Kyiv" },
  { names: ["видубицький монастир", "vydubychi monastery"], query: "Vydubychi Monastery, Kyiv" }
];

function makeMapsLink(query) {
  const q = encodeURIComponent(query);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/**
 * Просте виявлення відомих місць у тексті.
 * @param {string} text
 * @param {string} lang
 * @returns {Array<{name: string, url: string, query: string}>}
 */
export function detectLandmarksFromText(text = "", lang = "uk") {
  const low = text.toLowerCase();
  const found = [];
  for (const item of KNOWN_LANDMARKS) {
    for (const nm of item.names) {
      if (low.includes(nm)) {
        found.push({
          name: nm.charAt(0).toUpperCase() + nm.slice(1),
          url: makeMapsLink(item.query),
          query: item.query
        });
        break;
      }
    }
  }
  // прибираємо дублікати по url
  const uniq = [];
  const seen = new Set();
  for (const f of found) {
    if (!seen.has(f.url)) {
      seen.add(f.url);
      uniq.push(f);
    }
  }
  return uniq;
}

/**
 * Форматує масив визначних місць у масив HTML-рядків для Telegram.
 */
export function formatLandmarkLines(landmarks = [], lang = "uk") {
  const label = lang.startsWith("uk")
    ? "📍 Визначні місця на фото:"
    : lang.startsWith("ru")
      ? "📍 Достопримечательности на фото:"
      : "📍 Landmarks on photo:";
  const lines = [label];
  for (const lm of landmarks) {
    lines.push(`• ${lm.query} <a href="${lm.url}">↗︎</a>`);
  }
  return lines;
}
