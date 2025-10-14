// src/lib/apis/holidays.js

function arrow(url) { return ` <a href="${url}">↗︎</a>`; }

/**
 * Базовий провайдер: Nager.Date (без ключів).
 * Повертає масив { date: 'YYYY-MM-DD', name: '...' }.
 */
async function fetchUaHolidays(year) {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${encodeURIComponent(year)}/UA`;
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 60 * 60 * 6 } });
  if (!res.ok) throw new Error(`holidays HTTP ${res.status}`);
  const data = await res.json();

  return (data || [])
    // залишаємо загальнонаціональні (без розбивки по областях)
    .filter(x => x.counties == null)
    .map(x => ({ date: x.date, name: x.localName || x.name }));
}

/** СТАРА назва, яку імпортує існуючий код */
export async function getHolidays(year) {
  if (!year) year = new Date().getFullYear();
  return await fetchUaHolidays(year);
}

/** Форматування під вимогу: список + ОДНА маленька стрілочка на джерело */
export function formatHolidays(list, year) {
  if (!list?.length) return `Немає даних про свята.`;
  const body = list.map(x => `• <b>${x.name}</b> — ${x.date}`).join("\n");
  return `Національні свята України ${year}\n\n${body}${arrow("https://date.nager.at")}`;
}

/* --- ДОДАТКОВІ АЛІАСИ (як у моїй попередній версії) --- */
export { getHolidays as uaPublicHolidays };
export { formatHolidays as formatUaHolidays };