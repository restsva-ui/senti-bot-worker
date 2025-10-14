// src/lib/apis/holidays.js

function arrow(url) { return ` <a href="${url}">↗︎</a>`; }

export async function uaPublicHolidays(year) {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${encodeURIComponent(year)}/UA`;
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 60 * 60 * 6 } });
  if (!res.ok) throw new Error(`holidays HTTP ${res.status}`);
  const data = await res.json();
  return data
    .filter(x => x.global || x.launchYear || x.counties == null)
    .map(x => ({ date: x.date, name: x.localName || x.name }));
}

export function formatUaHolidays(list, year) {
  if (!list?.length) return `Немає даних про свята.`;
  const body = list.map(x => `• <b>${x.name}</b> — ${x.date}`).join("\n");
  return `Національні свята України ${year}\n\n${body}${arrow("https://date.nager.at")}`;
}
