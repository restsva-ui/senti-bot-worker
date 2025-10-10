// src/routes/brainApi.js
import { readChecklist, getArchive, listArchives } from "../lib/kvChecklist.js";
import { html, json } from "../utils/respond.js";
import { abs } from "../utils/url.js";

// Локальні утиліти для current/history
const CURRENT_ARCHIVE_KEY = "senti_repo_current";
const HISTORY_KEY = "senti_repo_history";

function ensureKv(env) {
  const kv = env.TODO_KV;
  if (!kv) throw new Error("TODO_KV binding missing (wrangler.toml)!");
  return kv;
}

async function getCurrent(env) {
  return await ensureKv(env).get(CURRENT_ARCHIVE_KEY);
}

async function setCurrent(env, key) {
  await ensureKv(env).put(CURRENT_ARCHIVE_KEY, String(key || ""));
}

async function pushHistory(env, prevKey) {
  if (!prevKey) return;
  const kv = ensureKv(env);
  const raw = await kv.get(HISTORY_KEY);
  let arr = [];
  try { arr = JSON.parse(raw || "[]"); } catch {}
  const filtered = arr.filter(k => k !== prevKey);
  filtered.unshift(prevKey);
  if (filtered.length > 20) filtered.length = 20;
  await kv.put(HISTORY_KEY, JSON.stringify(filtered));
}

export async function handleBrainApi(req, env, url) {
  const p = url.pathname;
  const method = req.method || "GET";
  const needSecret = () =>
    env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

  // --- 401 guard ---
  if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);

  // --- GET: чеклист (читання) ---
  if (p === "/api/brain/checklist" && method === "GET") {
    const text = await readChecklist(env);
    return json({ ok: true, text });
  }

  // --- GET: поточний snapshot (архів) ---
  if (p === "/api/brain/current" && method === "GET") {
    const current = await getCurrent(env);
    const all = await listArchives(env);
    const exists = all.includes(current);
    return json({ ok: true, current, exists, total: all.length });
  }

  // --- POST: зробити архів current ---
  if (p === "/api/brain/promote" && method === "POST") {
    let key = url.searchParams.get("key");
    if (!key) {
      try {
        const body = await req.json();
        key = body?.key;
      } catch {}
    }
    if (!key) return json({ ok: false, error: "key required" }, 400);

    // Перевірка, чи архів існує
    const b64 = await getArchive(env, key);
    if (!b64) return json({ ok: false, error: "archive not found" }, 404);

    // Зберігаємо попередній у історію
    const prev = await getCurrent(env);
    if (prev && prev !== key) await pushHistory(env, prev);

    await setCurrent(env, key);
    return json({ ok: true, promoted: key });
  }

  // --- fallback ---
  if (p.startsWith("/api/brain")) {
    return json({ ok: false, error: "unknown endpoint" }, 404);
  }

  return null; // не наш маршрут
}