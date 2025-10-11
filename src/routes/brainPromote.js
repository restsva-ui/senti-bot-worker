// src/routes/brainPromote.js
// Промоут (активація) архіву: зберігає назву ZIP у CHECKLIST_KV як "brain:current".

import { listArchives, appendChecklist } from "../lib/kvChecklist.js";

const CUR_KEY = "brain:current";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/**
 * Визначає key з query/form/json.
 * Якщо не передали — беремо:
 *   1) з CUR_KEY у CHECKLIST_KV (поточний поінтер)
 *   2) або найновіший з listArchives()
 */
async function resolveKey(req, env, url) {
  // 1) прямі способи
  let key =
    url.searchParams.get("key") ||
    (await req.clone().formData().then(f => f.get("key")).catch(() => null)) ||
    (await req.clone().json().then(j => j?.key).catch(() => null));

  if (key) return { key, source: "provided" };

  // 2) поінтер “current”
  const current = await env.CHECKLIST_KV.get(CUR_KEY);
  if (current) return { key: current, source: "current" };

  // 3) найновіший з історії
  const keys = await listArchives(env); // масив ключів
  if (keys.length > 0) return { key: keys[0], source: "latest" };

  return { key: null, source: "none" };
}

export async function handleBrainPromote(req, env, url) {
  if (!url.pathname.startsWith("/api/brain/promote")) return null;

  // допускаємо CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  // опціонально: вимагаємо секрет
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
    return json({ ok:false, error:"unauthorized" }, 401);
  }

  const { key, source } = await resolveKey(req, env, url);
  if (!key) return json({ ok: false, error: "missing key and nothing to promote" }, 400);

  // встановлюємо “пойнтер” на поточний архів
  await env.CHECKLIST_KV.put(CUR_KEY, key);
  await appendChecklist(env, `✅ promote (${source}) → ${key}`);

  return json({ ok: true, promoted: key, source });
}