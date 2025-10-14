// src/lib/apis/news.js

function arrow(url) { return ` <a href="${url}">↗︎</a>`; }

async function newsdataIO(key) {
  const url = `https://newsdata.io/api/1/latest?apikey=${encodeURIComponent(key)}&country=ua&language=uk`;
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 } });
  if (!res.ok) throw new Error(`newsdata HTTP ${res.status}`);
  const data = await res.json();
  const list = data?.results || [];
  return list.slice(0, 8).map(i => ({
    title: (i.title || i.description || "").trim(),
    link: i.link || i.source_url || ""
  })).filter(x => x.title && x.link);
}

async function rss(url) {
  const res = await fetch(url, { cf: { cacheEverything: true, cacheTtl: 300 } });
  if (!res.ok) throw new Error(`rss HTTP ${res.status}`);
  const xml = await res.text();
  const items = [];
  const re = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < 8) {
    const t = m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const l = m[2].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (t && l) items.push({ title: t, link: l });
  }
  return items;
}

async function rssTop() {
  const feeds = [
    "https://www.pravda.com.ua/rss/view_pubs/",
    "https://suspilne.media/rss/all/rss.xml",
    "https://www.ukrinform.ua/rss/block-lastnews",
    "https://www.bbc.com/ukrainian/index.xml"
  ];
  for (const f of feeds) {
    try {
      const items = await rss(f);
      if (items.length) return items;
    } catch {}
  }
  return [];
}

export async function fetchTopNews(key) {
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

export function formatNewsList(items = []) {
  if (!items?.length) return "";
  // У списку — ТІЛЬКИ текст заголовків (без <a>), щоб не було прев’ю.
  const list = items.slice(0, 8).map(n => `• ${n.title}`).join("\n");
  // Одна маленька стрілочка веде на першу новину.
  return list + arrow(items[0].link);
}
