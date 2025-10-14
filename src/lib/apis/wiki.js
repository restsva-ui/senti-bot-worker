// src/lib/apis/wiki.js
// Розумніший пошук: спершу summary, далі opensearch; фолбеки мов: uk -> ru -> en.

function arrow(url) { return ` <a href="${url}">↗︎</a>`; }

async function fetchSummary(title, lang = "uk") {
  const t = encodeURIComponent(title.replace(/\s+/g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${t}`;
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!res.ok) return null;
  const j = await res.json();
  if (!j?.extract) return null;
  return {
    title: j.title,
    extract: j.extract,
    url: j.content_urls?.desktop?.page || j.content_urls?.mobile?.page || ""
  };
}

async function openSearch1(query, lang = "uk") {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.searchParams.set("action", "opensearch");
  url.searchParams.set("search", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("namespace", "0");
  url.searchParams.set("format", "json");
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 3600 } });
  if (!res.ok) return null;
  const data = await res.json();
  const title = data?.[1]?.[0];
  return title || null;
}

/**
 * Головна функція: намагається summary; якщо немає — шукає назву через opensearch;
 * якщо все одно порожньо — фолбек на іншу мову (uk -> ru -> en).
 */
export async function wikiSummarySmart(query, preferLang = "uk") {
  const langs = [preferLang, ...(preferLang === "uk" ? ["ru", "en"] : ["uk", "en"])];

  for (const lang of langs) {
    // 1) пряма спроба
    const direct = await fetchSummary(query, lang);
    if (direct) return direct;
    // 2) opensearch -> summary
    const t = await openSearch1(query, lang);
    if (t) {
      const via = await fetchSummary(t, lang);
      if (via) return via;
    }
  }
  return null;
}

export function formatSummary(item) {
  if (!item) return "Не знайшов статтю.";
  return `<b>${item.title}</b>\n${item.extract}${item.url ? arrow(item.url) : ""}`;
}