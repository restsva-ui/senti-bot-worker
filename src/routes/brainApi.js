// src/routes/brainApi.js
import { readChecklist, getArchive, listArchives } from "../lib/kvChecklist.js";
import { html, json } from "../utils/respond.js";

const CURRENT_KEY = "senti_repo_current";
const HISTORY_KEY = "senti_repo_history";

function ensureKv(env) {
  if (!env.TODO_KV) throw new Error("TODO_KV binding missing");
  return env.TODO_KV;
}

async function getCurrent(env) {
  return await ensureKv(env).get(CURRENT_KEY);
}

async function setCurrent(env, key) {
  await ensureKv(env).put(CURRENT_KEY, String(key || ""));
}

async function pushHistory(env, key) {
  const kv = ensureKv(env);
  const raw = await kv.get(HISTORY_KEY);
  let arr = [];
  try { arr = JSON.parse(raw || "[]"); } catch {}
  if (key && !arr.includes(key)) arr.unshift(key);
  if (arr.length > 20) arr.length = 20;
  await kv.put(HISTORY_KEY, JSON.stringify(arr));
}

export async function handleBrainApi(req, env, url) {
  const p = url.pathname;
  const method = req.method || "GET";
  const needSecret = () =>
    env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

  if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);

  // --- GET /api/brain/checklist ---
  if (p === "/api/brain/checklist" && method === "GET") {
    const text = await readChecklist(env);
    return json({ ok: true, text });
  }

  // --- GET /api/brain/current ---
  if (p === "/api/brain/current" && method === "GET") {
    const current = await getCurrent(env);
    const all = await listArchives(env);
    const exists = all.includes(current);
    return json({ ok: true, current, exists, total: all.length });
  }

  // --- POST /api/brain/promote ---
  if (p === "/api/brain/promote" && method === "POST") {
    let key = url.searchParams.get("key");
    if (!key) {
      try {
        const body = await req.json();
        key = body?.key;
      } catch {}
    }
    if (!key) return json({ ok: false, error: "key required" }, 400);

    const b64 = await getArchive(env, key);
    if (!b64) return json({ ok: false, error: "archive not found" }, 404);

    const prev = await getCurrent(env);
    if (prev && prev !== key) await pushHistory(env, prev);
    await setCurrent(env, key);

    return json({ ok: true, promoted: key });
  }

  // --- fallback для інших підшляхів ---
  if (p.startsWith("/api/brain")) {
    return json({ ok: false, error: "unknown endpoint" }, 404);
  }

  return null;
}