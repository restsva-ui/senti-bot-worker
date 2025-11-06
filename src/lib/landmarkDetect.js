// src/lib/landmarkDetect.js
// Витягує з опису фото назви визначних місць і будує клікабельні посилання на Google Maps.

const COMMON_LANDMARKS = [
  // Європа
  "eiffel tower",
  "louvre",
  "notre-dame",
  "notre dame",
  "arc de triomphe",
  "colosseum",
  "trevi fountain",
  "sagrada familia",
  "big ben",
  "tower bridge",
  "westminster",
  "acropolis",
  "parthenon",
  // Україна
  "майдан незалежності",
  "києво-печерська лавра",
  "києво печерська лавра",
  "андріївська церква",
  "львівська ратуша",
  "одеський оперний театр",
  "харківський держпром"
];

function toTitleCase(s = "") {
  return s
    .split(" ")
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : "")
    .join(" ");
}

export function detectLandmarksFromText(text = "", lang = "uk") {
  const out = [];
  const lower = String(text || "").toLowerCase();

  // 1) за готовим списком
  for (const lm of COMMON_LANDMARKS) {
    if (lower.includes(lm)) {
      out.push({ name: lm, display: toTitleCase(lm) });
    }
  }

  // 2) евристика "в/у/in <Місто>"
  const cityRx = /(у|в|in)\s+([A-ZА-ЯІЇЄҐ][\w\-’'\. ]{2,40})/gmu;
  let m;
  while ((m = cityRx.exec(text)) !== null) {
    const city = m[2].trim();
    if (city && !out.find(o => o.display.toLowerCase() === city.toLowerCase())) {
      out.push({ name: city, display: city });
    }
  }

  return out;
}

export function formatLandmarkLines(landmarks = [], lang = "uk") {
  return landmarks.map(lm => {
    const label = lm.display || lm.name;
    const q = encodeURIComponent(label);
    const url = `https://www.google.com/maps/search/?api=1&query=${q}`;
    // маленька стрілка, як ти хотів
    return `📍 <b>${escapeHtml(label)}</b> — <a href="${url}">↗︎ карта</a>`;
  });
}

function escapeHtml(s = "") {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
