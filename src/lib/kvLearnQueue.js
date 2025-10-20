// src/lib/kvLearnQueue.js

/**
 * Minimal Learn queue on KV.
 * Keys:
 *   - learn:q:<ts>:<rand> -> JSON item { id, userId, kind, payload, at, status }
 *   - learn:last_summary  -> short text summary of last run
 *
 * Feature flag:
 *   - env.LEARN_ENABLED ("on" / "off")
 */

const Q_PREFIX = "learn:q:";
const K_LAST_SUMMARY = "learn:last_summary";

function enabled(env) {
  return String(env?.LEARN_ENABLED || "on").toLowerCase() !== "off";
}

function kv(env) {
  const kv = env?.LEARN_QUEUE_KV;
  if (!kv) throw new Error("LEARN_QUEUE_KV is not bound");
  return kv;
}

function id() {
  return Math.random().toString(36).slice(2) + "-" + Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

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
  await kv(env).put(key, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 14 }); // 14 days
  return { ok: true, key, item };
}

function detectKind(payload) {
  // Very light heuristic: url / file / text
  if (payload?.url) return "url";
  if (payload?.file || payload?.blob || payload?.name?.match?.(/\.(zip|rar|7z|pdf|docx|txt|md|csv)$/i)) return "file";
  return "unknown";
}

/** List queued items (lightweight) */
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

/** Internal: delete a queue key */
async function del(env, key) {
  try { await kv(env).delete(key); } catch {}
}

/** Save last summary text for HTML/admin UI */
export async function saveLastSummary(env, text) {
  await kv(env).put(K_LAST_SUMMARY, String(text || ""), { expirationTtl: 60 * 60 * 24 * 30 });
}

/** Read last summary text */
export async function getLastSummary(env) {
  return (await kv(env).get(K_LAST_SUMMARY)) || "";
}
/** One-off processor (used by nightly agent or manual "Run") */
export async function runLearnOnce(env, { maxItems = 10 } = {}) {
  if (!enabled(env)) return { ok: false, reason: "learn_disabled" };

  // Pull keys lazily
  const toProcess = [];
  const listing = await kv(env).list({ prefix: Q_PREFIX, limit: maxItems });
  for (const k of listing.keys || []) {
    const raw = await kv(env).get(k.name);
    if (!raw) { await del(env, k.name); continue; }
    try {
      const item = JSON.parse(raw);
      toProcess.push({ key: k.name, item });
    } catch {
      await del(env, k.name);
    }
  }

  const results = [];
  for (const { key, item } of toProcess) {
    try {
      const res = await learnItem(env, item);
      results.push({ id: item.id, ok: true, ...res });
    } catch (e) {
      results.push({ id: item.id, ok: false, error: String(e?.message || e) });
    } finally {
      // remove from queue regardless; if failed we'll surface it in summary
      await del(env, key);
    }
  }

  const summary = makeSummary(results);
  await saveLastSummary(env, summary);

  return {
    ok: true,
    processed: results.length,
    results,
    summary,
  };
}

/** Simulated learn step; plug real embedding/summarization later */
async function learnItem(env, item) {
  // Minimal “learning”: normalize source descriptor and store short insight.
  const { kind, payload } = item;
  let title = "";
  let src = "";

  if (kind === "url" && typeof payload?.url === "string") {
    src = payload.url;
    title = tryGuessTitleFromUrl(payload.url);
  } else if (kind === "file") {
    src = payload?.name || "file";
    title = payload?.name || "file";
  } else {
    src = payload?.name || "unknown";
    title = "material";
  }

  // Here you can call your LLM/embeddings pipeline later.
  // For now we return a compact “insight” stub compatible with UI.
  const insight = `Новий матеріал: ${title}`;

  return {
    kind,
    src,
    learned: true,
    insight,
  };
}

function tryGuessTitleFromUrl(u) {
  try {
    const url = new URL(u);
    const last = url.pathname.split("/").filter(Boolean).pop() || url.hostname;
    return decodeURIComponent(last).slice(0, 120);
  } catch { return "link"; }
}

function makeSummary(results) {
  if (!results?.length) return "✅ Черга порожня — немає нових матеріалів.";
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  const lines = [];
  if (ok.length) {
    lines.push(`✅ Опрацьовано: ${ok.length}`);
    ok.slice(0, 5).forEach((r, i) => {
      lines.push(`  ${i + 1}) ${r.insight}`);
    });
    if (ok.length > 5) lines.push(`  ... та ще ${ok.length - 5}`);
  }
  if (fail.length) {
    lines.push(`⚠️ З помилками: ${fail.length}`);
    fail.slice(0, 3).forEach((r, i) => {
      lines.push(`  - ${i + 1}) ${r.error}`);
    });
    if (fail.length > 3) lines.push(`  ... та ще ${fail.length - 3}`);
  }
  return lines.join("\n");
}
