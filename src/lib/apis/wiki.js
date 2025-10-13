// src/lib/apis/wiki.js
// Wikipedia summary (uk/ru/en/de/fr). Returns null on missing.

function arrow(url){ return ` <a href="${url}">↗︎</a>`; }

export async function wikiSummary(query, lang = "uk") {
  const title = encodeURIComponent(String(query || "").trim().replace(/\s+/g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`;
  try {
    const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 60 * 60 } });
    if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.extract) return null;
    return {
      title: data?.title || query,
      extract: data.extract,
      url: data?.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${title}`,
    };
  } catch (e) {
    console.error("[wiki] error:", e.message);
    return null;
  }
}

// ── форматер, який потребує твій webhook ──
export function formatWiki(w) {
  if (!w) return "";
  const excerpt = w.extract && w.extract.length > 700 ? w.extract.slice(0, 700) + "…" : (w.extract || "");
  return `📚 <b>${w.title}</b>\n${excerpt}${arrow(w.url)}`;
}

// alias на випадок старих імпортів
export const formatSummary = formatWiki;