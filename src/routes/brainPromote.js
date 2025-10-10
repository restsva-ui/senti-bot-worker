// src/routes/brainPromote.js
// Промоут (активація) архіву мозку: зберігає key як current у KV

import { saveArchive, appendChecklist } from "../lib/kvChecklist.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export async function handleBrainPromote(req, env, url) {
  const p = url.pathname;
  if (!p.startsWith("/api/brain/promote")) return null;

  // Дістаємо key (з тіла, query або JSON)
  let key =
    url.searchParams.get("key") ||
    (await req.clone().formData().then(f => f.get("key")).catch(() => null)) ||
    (await req.clone().json().then(j => j.key).catch(() => null));

  if (!key)
    return json({ ok: false, error: "missing key" }, 400);

  // Зберігаємо як поточний архів
  await saveArchive(env, "current", key);
  await appendChecklist(env, `✅ promoted → ${key}`);

  return json({ ok: true, promoted: key });
}