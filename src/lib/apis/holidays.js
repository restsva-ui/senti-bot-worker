export async function getHolidays() {
  const r = await fetch("https://date.nager.at/api/v3/PublicHolidays/2025/UA");
  const j = await r.json().catch(() => null);
  return (j || []).slice(0, 5).map(h => ({ date: h.date, name: h.localName }));
}

export function formatHolidays(list) {
  if (!list?.length) return "❌ Дані про свята відсутні.";
  return "🎉 Найближчі державні свята в Україні:\n" + list.map(h => `• ${h.date} — ${h.name}`).join("\n");
}