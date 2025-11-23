// src/lib/learnMemory.js
/**
 * Мінімальний «реальний» пайплайн:
 *  - дістаємо текст (URL -> fetch + strip HTML; R2 -> читаємо файл <= 2MB)
 *  - робимо embedding через Cloudflare AI (multilingual)
 *  - кладемо у Vectorize з метаданими
 *  - запитуємо через Vectorize.query для RAG
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2MB без важких парсерів

function textFromHtml(html) {
  try {
    const noScripts = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
                          .replace(/<style[\s\S]*?<\/style>/gi, " ");
    const text = noScripts.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text.slice(0, 200_000); // safety
  } catch { return ""; }
}

async function fetchUrlText(u) {
  const r = await fetch(u, { method: "GET" });
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    const html = await r.text();
    return textFromHtml(html);
  }
  if (ct.startsWith("text/") || ct.includes("json")) {
    return (await r.text()).slice(0, 200_000);
  }
  // бінарні — не читаємо
  return "";
}

async function readR2Small(env, key) {
  const obj = await env.R2.get(key);
  if (!obj) return "";
  if ((obj.size || 0) > MAX_BYTES) return "";
  const ct = obj.httpMetadata?.contentType || "";
  const body = await obj.text();
  if (ct.includes("html")) return textFromHtml(body);
  return String(body || "").slice(0, 200_000);
}

async function embed(env, text) {
  // multilingual — добре працює з укр/ru/en
  const model = "@cf/sbert/multilingual-e5-large";
  const out = await env.AI.run(model, { text });
  const vec = out?.data || out?.embedding || out?.vector || out;
  if (!Array.isArray(vec)) throw new Error("embedding failed");
  return vec.map(Number);
}

export async function processMaterialForMemory(env, item) {
  const { kind, payload, id } = item;
  let text = "";
  let src = "";
  let title = payload?.name || "";

  if (kind === "url" && payload?.url) {
    src = payload.url;
    text = await fetchUrlText(payload.url).catch(() => "");
    title ||= tryTitle(payload.url);
  } else if (payload?.r2Key && env.R2) {
    src = `r2:${payload.r2Key}`;
    text = await readR2Small(env, payload.r2Key).catch(() => "");
    title ||= payload.name || payload.r2Key;
  }

  if (!text) return { stored: false, reason: "no_text" };

  const vector = await embed(env, text);
  const metadata = {
    src,
    title: String(title || "material").slice(0, 200),
    at: new Date().toISOString(),
    len: text.length
  };

  await env.VEC.insert([{ id, values: vector, metadata }]);

  return { stored: true, meta: metadata };
}

export async function retrieveMemory(env, query, { topK = 3 } = {}) {
  const qVec = await embed(env, query);
  const res = await env.VEC.query(qVec, { topK, returnMetadata: true });
  const hits = (res?.matches || [])
    .filter(x => x?.score >= 0) // фільтр на всяк випадок
    .map(x => ({ id: x.id, score: x.score, meta: x.metadata }));
  return hits;
}

function tryTitle(u) {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").filter(Boolean).pop() || url.hostname;
    return decodeURIComponent(last).slice(0, 120);
  } catch { return "link"; }
}