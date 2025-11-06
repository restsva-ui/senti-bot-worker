// src/lib/landmarkDetect.js
export function detectLandmarksFromText(text = "", lang = "uk") {
  const s = String(text || "").toLowerCase();
  const out = [];

  const KNOWN = [
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
    "майдан незалежності",
    "києво-печерська лавра",
    "києво печерська лавра",
    "андріївська церква",
    "львівська ратуша",
    "одеський оперний театр"
  ];

  for (const lm of KNOWN) {
    if (s.includes(lm)) {
      out.push({ name: lm, display: toTitle(lm) });
    }
  }

  // простенька евристика: "у Львові", "в Парижі", "in London"
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
    return `📍 <b>${escapeHtml(label)}</b> — <a href="${url}">↗︎ карта</a>`;
  });
}

function toTitle(s = "") {
  return s.split(" ").map(w => w ? w[0].toUpperCase() + w.slice(1) : "").join(" ");
}
function escapeHtml(s = "") {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
