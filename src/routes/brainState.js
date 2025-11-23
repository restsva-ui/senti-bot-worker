// src/routes/brainState.js
import { readChecklist, readStatut, listArchives } from "../lib/kvChecklist.js";

export async function handleBrainState(req, env, url) {
  if (url.pathname !== "/brain/state") return null;

  // Захист (можеш зняти, якщо хочеш публічний read-only стан)
  const needSecret = () =>
    env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;
  if (needSecret()) {
    return new Response(JSON.stringify({ ok:false, error:"unauthorized" }, null, 2), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  // Читаємо KV паралельно
  const [checkText, statutText, archives] = await Promise.all([
    readChecklist(env),
    readStatut(env),
    listArchives(env)
  ]);

  // Маленький аналіз: останній рядок зі словом status (green/red) якщо є
  const lines = (checkText || "").split(/\r?\n/).filter(Boolean);
  const lastStatusLine = [...lines].reverse().find(l => /status\s*:/i.test(l));
  let last_status = null;
  if (lastStatusLine) {
    const m = lastStatusLine.match(/status\s*:\s*(green|red)/i);
    if (m) last_status = m[1].toLowerCase();
  }

  const payload = {
    ok: true,
    service: env.SERVICE_HOST || "",
    deploy_id: env.DEPLOY_ID || "",
    last_status,                   // "green" | "red" | null
    checklist_lines: lines.length, // просто індикатор обсягу
    checklist: checkText || "",
    statut: statutText || "",
    archives: archives || []
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}