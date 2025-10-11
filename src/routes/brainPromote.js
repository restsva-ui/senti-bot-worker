// src/routes/brainPromote.js
// Промоут (активація) архіву мозку: зберігає key як current у KV

import { saveArchive, appendChecklist, getArchive, listArchives } from "../lib/kvChecklist.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/**
 * Дістає key з query, form-data або JSON. Якщо не передали:
 * 1) пробує взяти current з KV;
 * 2) якщо і там порожньо — бере найсвіжіший з listArchives().
 */
async function resolveKey(req, env, url) {
  // 1) прямі способи
  let key =
    url.searchParams.get("key") ||
    (await req.clone().formData().then(f => f.get("key")).catch(() => null)) ||
    (await req.clone().json().then(j => j?.key).catch(() => null));

  if (key) return { key, source: "provided" };

  // 2) поточний
  const cur = await getArchive(env, "current");
  if (cur) return { key: cur, source: "current" };

  // 3) найновіший з історії
  const { items = [] } = await listArchives(env);
  if (items.length > 0) return { key: items[0], source: "latest" };

  return { key: null, source: "none" };
}

export async function handleBrainPromote(req, env, url) {
  const p = url.pathname;
  if (!p.startsWith("/api/brain/promote")) return null;

  // Дозволяємо GET/POST, інші методи — 405
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  const { key, source } = await resolveKey(req, env, url);

  if (!key) {
    return json({ ok: false, error: "missing key and nothing to promote" }, 400);
  }

  // Зберігаємо як поточний архів
  await saveArchive(env, "current", key);
  const note = `✅ promote (${source}) → ${key}`;
  await appendChecklist(env, note);

  return json({ ok: true, promoted: key, source });
}