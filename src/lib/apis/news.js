// src/lib/apis/news.js
// News via newsdata.io (if key provided) with fallback to RSS (no key).

async function newsdataIO(key) {
  const url = `https://newsdata.io/api/1/latest?apikey=${encodeURIComponent(key)}&country=ua&language=uk`;
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 60 * 5 } });
  if (!res.ok) throw new Error(`newsdata HTTP ${res.status}`);
  const data = await res.json();
  const list = data?.results || [];
  return list.slice(0, 8).map(i => ({
    title: (i.title || i.description || "").trim(),
    link: i.link || i.source_url || ""
  })).filter(x => x.title && x.link);
}

// Fallback via RSS using jina.ai proxy (no CORS/keys)
async function fetchRSS(url) {
  const r = await fetch(`https://r.jina.ai/http://` + url, { cf: { cacheEverything: true, cacheTtl: 60 * 5 } });
  if (!r.ok) throw new Error("RSS fetch failed");
  const text = await r.text();
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(text))) {
    const chunk = m[1];
    const t = (chunk.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || chunk.match(/<title>(.*?)<\/title>/))?.[1];
    const l = (chunk.match(/<link>(.*?)<\/link>/))?.[1];
    if (t && l) items.push({ title: t.replace(/&amp;/g,"&").trim(), link: l.trim() });
    if (items.length >= 8) break;
  }
  return items;
}

async function rssTop() {
  const feeds = [
    "www.pravda.com.ua/rss/view_pubs/",
    "www.epravda.com.ua/rss/all/",
    "telegraf.com.ua/feed/"
  ];
  const results = [];
  for (const f of feeds) {
    try {
      const items = await fetchRSS(f);
      results.push(...items);
      if (results.length >= 8) break;
    } catch (e) {
      console.warn("[news] RSS failed:", f, e.message);
    }
  }
  return results.slice(0, 8);
}

export async function fetchTopNews(env = {}) {
  const key = env.NEWS_API_KEY || env.NEWSDATA_API_KEY;
  if (key) {
    try {
      const viaKey = await newsdataIO(key);
      if (viaKey.length) return viaKey;
    } catch (e) {
      console.warn("[news] newsdata failed:", e.message);
    }
  }
  return await rssTop();
}