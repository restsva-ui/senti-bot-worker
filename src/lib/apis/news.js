// Легкий парсер RSS без залежностей (тільки <item><title><link><pubDate>)
const FEEDS = {
  ua: [
    "https://www.pravda.com.ua/rss/view_news/",
    "https://suspilne.media/rss/all.xml",
    "https://nv.ua/ukr/rss/all.xml"
  ],
  ru: ["https://www.bbc.com/russian/index.xml"],
  en: ["https://feeds.bbci.co.uk/news/rss.xml"]
};

function parseItems(xml, limit = 5) {
  const items = [];
  const reItem = /<item>([\s\S]*?)<\/item>/g;
  let m; 
  while ((m = reItem.exec(xml)) && items.length < limit) {
    const block = m[1];
    const get = (tag) => {
      const mm = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
      return mm ? mm[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    };
    items.push({ title: get("title"), link: get("link"), date: get("pubDate") });
  }
  return items;
}

export async function fetchNews(lang = "uk", limit = 5) {
  const group = FEEDS[lang === "uk" ? "ua" : lang] || FEEDS.ua;
  const first = group[0];
  const r = await fetch(first, { cf: { cacheEverything: true, cacheTtl: 180 }});
  if (!r.ok) throw new Error("rss fail");
  const xml = await r.text();
  return parseItems(xml, limit);
}

export function formatNewsList(arr) {
  if (!arr?.length) return "Новини недоступні.";
  return arr.map(x => `• ${x.title}\n${x.link}`).join("\n\n");
}