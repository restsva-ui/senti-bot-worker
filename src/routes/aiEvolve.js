// src/routes/aiEvolve.js
import { listArchives, appendChecklist } from "../lib/kvChecklist.js";
import { json } from "../utils/respond.js";

/**
 * /ai/evolve/run — порівнює два останні архіви і фіксує зміни
 */
export async function handleAiEvolve(req, env, url) {
  const p = url.pathname;
  if (p !== "/ai/evolve/run") return null;

  const archives = await listArchives(env);
  if (archives.length < 2)
    return json({ ok: false, error: "not enough archives to compare" }, 400);

  const last = archives.at(-1);
  const prev = archives.at(-2);

  const summary = `🧩 evolution: ${last} > ${prev}`;

  await appendChecklist(env, summary);
  await env.CHECKLIST_KV.put("brain:evolution:last", summary);

  return json({
    ok: true,
    message: "Evolution summary saved",
    compared: { previous: prev, current: last },
  });
}