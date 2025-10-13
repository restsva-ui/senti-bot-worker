// src/lib/apis/wiki.js
// Simple Wikipedia summary (uk) via REST API (no keys).

export async function wikiSummary(query, lang = "uk") {
  const title = encodeURIComponent(query.trim().replace(/\s+/g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`;
  try {
    const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 60 * 60 } });
    if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
    const data = await res.json();
    const text = data?.extract || "";
    const page = data?.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${title}`;
    return {
      title: data?.title || query,
      extract: text,
      url: page
    };
  } catch (e) {
    console.error("[wiki] error:", e.message);
    return null;
  }
}

export function formatWiki(w) {
  if (!w) return "Не вдалося отримати статтю Вікіпедії 😕";
  const excerpt = w.extract?.length > 700 ? w.extract.slice(0, 700) + "…" : w.extract;
  return `📚 <b>${escapeHtml(w.title)}</b>\n${escapeHtml(excerpt)}\n<a href="${w.url}">Читати більше</a>`;
}

// alias for backward compatibility
export const formatSummary = formatWiki;

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}