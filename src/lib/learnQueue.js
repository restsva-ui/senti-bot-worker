// Lightweight learning queue for Senti
// Stores items in KV and lets nightly agent consume them later.
// It prefers LEARN_QUEUE_KV but gracefully falls back to TODO_KV or STATE_KV.

const PREFIX = "q:learn:item:";   // items
const META_PREFIX = "q:learn:meta:"; // optional per-id meta

function getKV(env) {
  const kv =
    env.LEARN_QUEUE_KV ||
    env.TODO_KV ||
    env.STATE_KV;
  if (!kv) throw new Error("No KV binding for learn queue (expected LEARN_QUEUE_KV / TODO_KV / STATE_KV).");
  return kv;
}

function nowTs() {
  return Date.now();
}

function rand4() {
  return Math.random().toString(16).slice(2, 6);
}

function makeId() {
  // time-first so KV.list(prefix) returns items in chronological order
  const ts = nowTs();
  return `${ts}-${rand4()}${rand4()}`;
}

function isUrl(s = "") {
  try {
    const u = new URL(String(s));
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeStr(x, max = 4000) {
  if (x == null) return "";
  let s = String(x);
  if (s.length > max) s = s.slice(0, max);
  return s;
}

/**
 * Normalizes raw input to a queue item payload.
 * Accepts:
 *  - string URL
 *  - string text (non-URL)
 *  - { type, url, name } for files/links
 */
function normalizeInput(input) {
  // URL string
  if (typeof input === "string" && isUrl(input)) {
    return { kind: "url", url: sanitizeStr(input, 2048) };
  }
  // Text string
  if (typeof input === "string") {
    return { kind: "text", text: sanitizeStr(input, 4000) };
  }
  // Object {type,url/name/text}
  if (input && typeof input === "object") {
    const kind = input.kind || input.type || (input.url ? "url" : (input.text ? "text" : "unknown"));
    const out = { kind: String(kind || "unknown") };
    if (input.url) out.url = sanitizeStr(input.url, 2048);
    if (input.text) out.text = sanitizeStr(input.text, 4000);
    if (input.name) out.name = sanitizeStr(input.name, 256);
    if (input.mime) out.mime = sanitizeStr(input.mime, 128);
    if (input.size) out.size = Number(input.size) || undefined;
    return out;
  }
  // Fallback
  return { kind: "unknown", text: sanitizeStr(String(input)) };
}

/**
 * Enqueue a learning item.
 * @param {Env} env
 * @param {string|number} userId
 * @param {string|object} input - url/text/file descriptor
 * @param {object} [opts] - { note, priority }
 * @returns {Promise<object>} stored item
 */
export async function enqueueLearnItem(env, userId, input, opts = {}) {
  const kv = getKV(env);
  const id = makeId();
  const payload = normalizeInput(input);

  const item = {
    id,
    ts: nowTs(),
    userId: String(userId || ""),
    status: "queued",            // queued | processing | done | error
    tries: 0,
    lastError: null,
    priority: Number(opts.priority || 0),
    payload,                     // { kind, url|text|name|... }
    note: sanitizeStr(opts.note || "", 512),
    // reserved fields for future: tags, source, lang, checksum
  };

  // KV write
  await kv.put(PREFIX + id, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 30 }); // 30d TTL

  // Optional meta (small)
  try {
    const meta = {
      brief:
        payload.kind === "url"
          ? `url:${(payload.url || "").slice(0, 120)}`
          : payload.kind === "text"
          ? `text:${(payload.text || "").slice(0, 120)}`
          : payload.kind,
      userId: item.userId,
      ts: item.ts,
    };
    await kv.put(META_PREFIX + id, JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch {}

  return item;
}

/**
 * List queued items (lightweight).
 * @param {Env} env
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
export async function listLearnQueue(env, limit = 20) {
  const kv = getKV(env);
  const list = await kv.list({ prefix: PREFIX, limit });
  const out = [];
  for (const k of list.keys || []) {
    const v = await kv.get(k.name);
    if (!v) continue;
    try {
      out.push(JSON.parse(v));
    } catch {}
  }
  // Sort by timestamp asc (KV.list is already lexicographic by key with ts first, but re-check)
  out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return out;
}

/**
 * Get the next item (and optionally mark as processing).
 */
export async function dequeueNext(env, { lock = true } = {}) {
  const kv = getKV(env);
  const list = await kv.list({ prefix: PREFIX, limit: 10 });
  for (const k of list.keys || []) {
    const raw = await kv.get(k.name);
    if (!raw) continue;
    let item;
    try { item = JSON.parse(raw); } catch { continue; }
    if (item.status !== "queued") continue;

    if (!lock) return item;

    item.status = "processing";
    item.tries = (item.tries || 0) + 1;
    await kv.put(k.name, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 30 });
    return item;
  }
  return null;
}

/**
 * Mark item as done and optionally attach summary.
 */
export async function markDone(env, id, result = {}) {
  const kv = getKV(env);
  const key = PREFIX + id;
  const raw = await kv.get(key);
  if (!raw) return false;
  let item;
  try { item = JSON.parse(raw); } catch { return false; }
  item.status = "done";
  item.result = result || null;
  item.doneTs = nowTs();
  await kv.put(key, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 30 });
  return true;
}

/**
 * Mark item as error (keeps it for later inspection).
 */
export async function markError(env, id, err) {
  const kv = getKV(env);
  const key = PREFIX + id;
  const raw = await kv.get(key);
  if (!raw) return false;
  let item;
  try { item = JSON.parse(raw); } catch { return false; }
  item.status = "error";
  item.lastError = String(err?.message || err).slice(0, 500);
  item.errorTs = nowTs();
  await kv.put(key, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 30 });
  return true;
}

/**
 * Peek single item by id.
 */
export async function getItem(env, id) {
  const kv = getKV(env);
  const raw = await kv.get(PREFIX + id);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Soft delete (cleanup).
 */
export async function removeItem(env, id) {
  const kv = getKV(env);
  await kv.delete(PREFIX + id).catch(() => {});
  await kv.delete(META_PREFIX + id).catch(() => {});
  return true;
}

/**
 * Count (approx) queued items — shallow scan (cheap).
 */
export async function countQueued(env, sample = 100) {
  const kv = getKV(env);
  const list = await kv.list({ prefix: PREFIX, limit: sample });
  let n = 0;
  for (const k of list.keys || []) {
    const v = await kv.get(k.name);
    if (!v) continue;
    try {
      const it = JSON.parse(v);
      if (it.status === "queued") n++;
    } catch {}
  }
  return { approx: n, scanned: (list.keys || []).length };
}