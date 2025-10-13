export async function fetchTopNews() {
  const r = await fetch("https://newsdata.io/api/1/news?country=ua&language=uk&apikey=pub_41646b22dc471a25fa66e2ed37ff6cda265b");
  const j = await r.json().catch(() => null);
  const list = j?.results?.slice(0, 5) || [];
  return list.map(a => ({ title: a.title, link: a.link }));
}

export function formatNewsList(list) {
  if (!list?.length) return "❌ Новини недоступні.";
  return "🗞️ Топ-новини України:\n" + list.map(n => `• [${n.title}](${n.link})`).join("\n");
}