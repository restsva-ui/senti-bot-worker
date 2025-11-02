// src/flows/usePhotoMemory.js
// Текстовий handler, що використовує «памʼять фото».
// Використання у webhook: 
//   const ctxReply = await maybeAnswerUsingPhotoMemory(env, chatId, text);
//   if (ctxReply) return sendHTML(ctxReply.text);

import { loadPhotoMemory, clearPhotoMemory } from "../lib/photoMemory.js";

const REASK_PATTERNS = [
  /що це(\?)?$/i,
  /що на фото/i,
  /розкажи про фото/i,
  /продовжуй про фото/i,
  /деталі про це фото/i,
  /дай лінк(и)? на мапу/i,
  /map( link)?/i
];

export async function maybeAnswerUsingPhotoMemory(env, chatId, textRaw) {
  const text = String(textRaw || "").trim();

  // Службові команди
  if (/^\/clear_photo\b/i.test(text)) {
    await clearPhotoMemory(env, chatId);
    return { text: "🧹 Пам’ять фото очищено.", parse_mode: "HTML" };
  }
  if (/^\/photo\b/i.test(text)) {
    const mem = await loadPhotoMemory(env, chatId);
    if (!mem) return { text: "Фото в контексті поки немає.", parse_mode: "HTML" };
    return { text: formatFromMemory(mem), parse_mode: "HTML" };
  }

  // Евристика: текст схожий на продовження про попереднє фото?
  if (REASK_PATTERNS.some((re) => re.test(text))) {
    const mem = await loadPhotoMemory(env, chatId);
    if (!mem) return { text: "Нещодавнього фото в контексті немає. Надішли зображення ще раз.", parse_mode: "HTML" };
    return { text: formatFromMemory(mem), parse_mode: "HTML" };
  }

  // Нічого не робимо — нехай далі працює звичайний текстовий пайплайн
  return null;
}

function formatFromMemory(mem) {
  const parts = [];
  // опис
  if (mem.description) parts.push(mem.description);

  // OCR (якщо не «водяні знаки» — це вже відфільтровано на етапі збереження)
  if (mem.ocrText) parts.push(`Текст на фото: "${mem.ocrText.replace(/\s+/g, " ").slice(0, 300)}"`);

  // компактні іконки ↗︎ на мапу
  const icons = (mem.landmarks || []).slice(0, 4).map(lm => mapIcon(lm));
  if (icons.length) parts.push("Посилання на мапу: " + icons.join("  "));

  // помітка, якщо це деградований (фолбек) стан
  if (mem.degraded) parts.push("ℹ️ Аналіз фото був тимчасово недоступний.");

  return parts.join("\n");
}

// Той самий генератор іконки, що й у visionDescribe.js
function mapIcon({ name, lat, lon, city, country }) {
  const q = (typeof lat === "number" && typeof lon === "number")
    ? `${lat},${lon}`
    : [name, city, country].filter(Boolean).join(", ");
  const url = `https://maps.google.com/?q=${encodeURIComponent(q)}`;
  return `<a href="${url}">↗︎</a>`;
}
