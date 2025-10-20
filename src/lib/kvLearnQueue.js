// src/lib/kvLearnQueue.js
const Q_PREFIX = "learn:q:";
const K_LAST_SUMMARY = "learn:last_summary";

function enabled(env) {
  return String(env?.LEARN_ENABLED || "on").toLowerCase() !== "off";
}
function kv(env) {
  const store = env?.LEARN_QUEUE_KV;
  if (!store) throw new Error("LEARN_QUEUE_KV is not bound");
  return store;
}

function id() { return Math.random().toString(36).slice(2) + "-" + Date.now(); }
function nowIso() { return new Date().toISOString(); }

/** Put any learn payload into queue */
export async function enqueueLearn(env, userId, payload) {
  if (!enabled(env)) return { ok: false, reason: "learn_disabled" };
  const item = {
    id: id(),
    userId: String(userId || "anon"),
    kind: detectKind(payload),
    payload,
    at: nowIso(),
    status: "queued",
  };
  const key = `${Q_PREFIX}${Date.now()}:${item.id}`;
  await kv(env).put(key, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 14 });
  return { ok: true, key, item };
}

function detectKind(payload) {
  if (payload?.url) return "url";
  if (payload?.file || payload?.blob || payload?.name?.match?.(/\.(zip|rar|7z|pdf|docx|txt|md|csv)$/i)) return "file";
  return "unknown";
}

export async function listQueued(env, { limit = 50 } = {}) {
  const list = await kv(env).list({ prefix: Q_PREFIX, limit });
  const out = [];
  for (const k of list.keys || []) {
    const raw = await kv(env).get(k.name);
    if (!raw) continue;
    try { out.push(JSON.parse(raw)); } catch {}
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

async function del(env, key) {
  try { await kv(env).delete(key); } catch {}
}

export async function saveLastSummary(env, text) {
  await kv(env).put(K_LAST_SUMMARY, String(text || ""), { expirationTtl: 60 * 60 * 24 * 30 });
}
export async function getLastSummary(env) {
  return (await kv(env).get(K_LAST_SUMMARY)) || "";
}

export async function runLearnOnce(env, { maxItems = 10 } = {}) {
  if (!enabled(env)) return { ok: false, reason: "learn_disabled" };

  const toProcess = [];
  const listing = await kv(env).list({ prefix: Q_PREFIX, limit: maxItems });
  for (const k of listing.keys || []) {
    const raw = await kv(env).get(k.name);
    if (!raw) { await del(env, k.name); continue; }
    try { toProcess.push({ key: k.name, item: JSON.parse(raw) }); }
    catch { await del(env, k.name); }
  }

  const results = [];
  for (const { key, item } of toProcess) {
    try {
      const res = await learnItem(env, item);
      results.push({ id: item.id, ok: true, ...res });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: String(e?.message || e) });
    } finally {
      await del(env, key);
    }
  }

  const summary = makeSummary(results);
  await saveLastSummary(env, summary);

  return { ok: true, processed: results.length, results, summary };
}

/** Minimal learn stub (місце для реальних ембеддингів) */
async function learnItem(env, item) {
  const { kind, payload } = item;
  let title = "", src = "", note = "";

  if (kind === "url" && typeof payload?.url === "string") {
    src = payload.url;
    title = tryGuessTitleFromUrl(payload.url);
    note = detectPrettySource(payload.url);
  } else if (kind === "file") {
    src = payload?.name || "file";
    title = payload?.name || "file";
    note = "(файл)";
  } else {
    src = payload?.name || "unknown";
    title = "матеріал";
  }

  const insight = `Вивчено: ${title} ${note ? note : ""}`.trim();

  return { kind, src, learned: true, insight };
}

function tryGuessTitleFromUrl(u) {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").filter(Boolean).pop() || url.hostname;
    return decodeURIComponent(last).slice(0, 120);
  } catch { return "посилання"; }
}

function detectPrettySource(u) {
  try {
    const h = new URL(u).hostname;
    if (/youtu\.?be/i.test(h)) return "(відео YouTube)";
    if (/drive\.google\.com/i.test(h)) return "(Google Drive)";
    if (/dropbox\.com/i.test(h)) return "(Dropbox)";
    return `(${h})`;
  } catch { return ""; }
}

function makeSummary(results) {
  if (!results?.length) return "✅ Черга порожня — немає нових матеріалів.";

  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  const lines = [];

  if (ok.length) {
    lines.push(`✅ Опрацьовано: ${ok.length}`);
    ok.slice(0, 5).forEach((r, i) => { lines.push(`  ${i + 1}) ${r.insight}`); });
    if (ok.length > 5) lines.push(`  … та ще ${ok.length - 5}`);
  }
  if (fail.length) {
    lines.push(`⚠️ З помилками: ${fail.length}`);
    fail.slice(0, 3).forEach((r, i) => { lines.push(`  - ${i + 1}) ${r.error}`); });
    if (fail.length > 3) lines.push(`  … та ще ${fail.length - 3}`);
  }
  return lines.join("\n");
}
