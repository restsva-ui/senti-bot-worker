// src/lib/apis/holidays.js
export async function getHolidays() {
  try {
    const res = await fetch("https://date.nager.at/api/v3/PublicHolidays/2025/UA");
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Invalid holidays response");
    return data.slice(0, 5).map(h => ({
      date: h.date,
      name: h.localName || h.name,
    }));
  } catch (e) {
    return [];
  }
}

export function formatHolidays(list) {
  if (!Array.isArray(list) || !list.length) {
    return "❌ Немає даних про державні свята.";
  }
  return (
    "🎉 Найближчі державні свята в Україні:\n" +
    list.map(h => `• ${h.date} — ${h.name}`).join("\n")
  );
}