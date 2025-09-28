export async function wikiSummary(q: string, lang: "uk" | "en" = "uk") {
  const enc = encodeURIComponent(q);
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${enc}`;
  const r = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!r.ok) throw new Error(`wiki ${lang} ${r.status}`);
  const j = await r.json<any>();
  if (j.extract) {
    const title = j.title || q;
    const link = j.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${enc}`;
    return `*${title}*\n${j.extract}\n\n${link}`;
  }
  throw new Error("no extract");
}