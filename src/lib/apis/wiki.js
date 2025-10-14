// src/lib/apis/wiki.js

function arrow(url) { return ` <a href="${url}">↗︎</a>`; }

async function fetchSummary(title, lang = "uk") {
  const t = encodeURIComponent(title.replace(/\s+/g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${t}`;
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!res.ok) return null;
  const j = await res.json();
  if (!j?.extract) return null;
  return { title: j.title, extract: j.extract, url: j.content_urls?.desktop?.page || j.content_urls?.mobile?.page || "" };
}

export async function wikiSummary(query, lang = "uk") {
  // спроба за назвою; без пошуку, щоб не ускладнювати
  return await fetchSummary(query, lang);
}

export function formatSummary(item) {
  if (!item) return "Не знайшов статтю.";
  return `<b>${item.title}</b>\n${item.extract}${item.url ? arrow(item.url) : ""}`;
}
