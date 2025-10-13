// Wikimedia summary API (короткий опис сторінки українською)
export async function wikiSummary(title, lang = "uk") {
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const r = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 3600 }});
  if (!r.ok) throw new Error("wiki fail");
  const j = await r.json();
  return { title: j.title, extract: j.extract, url: j.content_urls?.desktop?.page };
}
export function formatSummary(x){
  return x?.extract ? `${x.title}\n${x.extract}\n\n${x.url}` : "Не знайшов короткий опис.";
}