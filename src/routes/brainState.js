// src/routes/brainState.js
import { readChecklist, readStatut, listArchives } from "../lib/kvChecklist.js";

export async function handleBrainState(req, env, url) {
  if (url.pathname !== "/brain/state") return null;

  // опційний захист (можна залишити відкритим read-only; якщо хочеш — вмикаємо секрет)
  const needSecret = () => env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;
  if (needSecret()) {
    return new Response(JSON.stringify({ ok:false, error:"unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }

  const [checkText, statutText, archives] = await Promise.all([
    readChecklist(env),
    readStatut(env),
    listArchives(env)
  ]);

  const payload = {
    ok: true,
    service: env.SERVICE_HOST || "",
    deploy_id: env.DEPLOY_ID || "",
    checklist: checkText || "",
    statut: statutText || "",
    archives: archives || []
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}