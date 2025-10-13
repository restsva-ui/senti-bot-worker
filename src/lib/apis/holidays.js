// src/lib/apis/holidays.js
// Public holidays via Nager.Date (no API key).
// getHolidays(country, year) → [{date,name}]
export async function getHolidays(country = "UA", year = new Date().getFullYear()) {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${encodeURIComponent(year)}/${encodeURIComponent(country)}`;
  try {
    const res = await fetch(url, {
      cf: { cacheEverything: true, cacheTtl: 60 * 60 * 2 }, // 2h cache
    });
    if (!res.ok) throw new Error(`Holidays HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Invalid holidays payload");
    return data.map(h => ({
      date: h.date,
      name: h.localName || h.name,
      countryCode: h.countryCode
    }));
  } catch (e) {
    console.error("[holidays] error:", e.message);
    return [];
  }
}