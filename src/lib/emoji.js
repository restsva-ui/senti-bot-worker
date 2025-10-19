// src/lib/emoji.js
// Стисла, сучасна палітра (iOS/Android friendly)
const EMO = {
  wave: "👋",
  sparkles: "✨",
  uk: "🇺🇦",
  info: "ℹ️",
  brain: "🧠",
  rocket: "🚀",
  check: "✅",
  x: "❌",
  link: "🔗",
  doc: "📄",
  video: "🎬",
  audio: "🎧",
  image: "🖼️",
  bolt: "⚡",
  sun: "☀️",
  cloud: "☁️",
  rain: "🌧️",
};

export function oneFor(text = "") {
  const s = text.toLowerCase();
  if (/video|youtube|yt|watch/.test(s)) return EMO.video;
  if (/pdf|docx|txt|file|document|doc/.test(s)) return EMO.doc;
  if (/image|photo|pic|jpg|png/.test(s)) return EMO.image;
  if (/weather|погод|climate/.test(s)) return EMO.sun;
  if (/learn|study|teach|навчан/.test(s)) return EMO.brain;
  if (/drive|google/.test(s)) return EMO.link;
  return EMO.sparkles;
}

export const E = EMO;