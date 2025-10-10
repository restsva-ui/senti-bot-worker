// src/routes/brainApi.js
import { listArchives, appendChecklist } from "../lib/kvChecklist.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const needSecret = (env, url) =>
  env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

// KV-ключ де зберігаємо “актуальний” зелений архів
const CUR_KEY = "brain:current";

export async function handleBrainApi(req, env, url) {
  const p = url.pathname;

  // GET /api/brain/current  — хто зараз “актуальний”
  if (p === "/api/brain/current" && req.method === "GET") {
    const current = await env.CHECKLIST_KV.get(CUR_KEY);
    return json({ ok: true, current, exists: !!current });
  }

  // GET /api/brain/list — перелік архівів (для зручного вибору)
  if (p === "/api/brain/list" && req.method === "GET") {
    if (needSecret(env, url)) return json({ ok: false, error: "unauthorized" }, 401);
    const keys = await listArchives(env);
    return json({ ok: true, total: keys.length, items: keys });
  }

  // /api/brain/promote — зробити архів “актуальним”
  //  • підтримує: POST (body: {key}) і GET (?key=...)
  if (p === "/api/brain/promote" && (req.method === "POST" || req.method === "GET")) {
    if (needSecret(env, url)) return json({ ok: false, error: "unauthorized" }, 401);

    let key = url.searchParams.get("key");
    if (req.method === "POST" && !key) {
      try {
        const body = await req.json();
        key = body?.key;
      } catch {}
    }
    if (!key) return json({ ok: false, error: "key required" }, 400);

    await env.CHECKLIST_KV.put(CUR_KEY, key);
    await appendChecklist(env, `promote: ${key}`);

    return json({ ok: true, promoted: key });
  }

  return null;
}