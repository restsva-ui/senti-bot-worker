// Nager.Date — державні свята
export async function publicHolidays(year, country = "UA") {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`;
  const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 86400 }});
  if (!r.ok) throw new Error("holidays fail");
  return await r.json(); // [{date, localName, name},...]
}
export function formatHolidaysShort(list, limit = 8) {
  return (list || []).slice(0, limit)
    .map(x => `• ${x.date} — ${x.localName || x.name}`)
    .join("\n");
}