// src/routes/aiTrain.js
import { readChecklist, listArchives, appendChecklist } from "../lib/kvChecklist.js";
import { json } from "../utils/respond.js";

/**
 * /ai/train/analyze — читає checklist і архіви, повертає короткий звіт
 * /ai/train/auto — автоматично промотує останній стабільний мозок
 */
export async function handleAiTrain(req, env, url) {
  const p = url.pathname;

  // --- /ai/train/analyze ---
  if (p === "/ai/train/analyze") {
    const checklist = await readChecklist(env);
    const archives = await listArchives(env);

    const lines = checklist.split("\n").slice(-15);
    const greens = lines.filter(l => /зелен|green|✅|success|ok/i.test(l));

    const report = {
      ok: true,
      total_archives: archives.length,
      last_logs: lines,
      green_deploys: greens.length,
      last_green: greens.at(-1) || "—",
    };

    return json(report);
  }

  // --- /ai/train/auto ---
  if (p === "/ai/train/auto") {
    const checklist = await readChecklist(env);
    const archives = await listArchives(env);
    const greens = checklist.split("\n").filter(l => /зелен|green|✅|success|ok/i.test(l));
    const last = archives.at(-1);

    if (!last) {
      await appendChecklist(env, "⚠️ auto-train: архівів не знайдено");
      return json({ ok: false, error: "no archives found" }, 404);
    }

    const stable = greens.length > 0 && /success|ok|✅/.test(greens.at(-1));

    if (stable) {
      await env.CHECKLIST_KV.put("brain:current", last);
      await appendChecklist(env, `🧠 auto-promote success → ${last}`);
      return json({ ok: true, promoted: last });
    } else {
      await appendChecklist(env, "⚠️ auto-train: немає стабільного деплою");
      return json({ ok: false, reason: "no stable deploys found" });
    }
  }

  return null;
}