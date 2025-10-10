// src/routes/aiTrain.js
import { readChecklist, listArchives } from "../lib/kvChecklist.js";
import { json } from "../utils/respond.js";

/**
 * /ai/train/analyze — читає checklist і архіви, повертає короткий звіт
 */
export async function handleAiTrain(req, env, url) {
  const p = url.pathname;

  if (p === "/ai/train/analyze") {
    const checklist = await readChecklist(env);
    const archives = await listArchives(env);

    // 1️⃣ Витягуємо останні 10 записів
    const lines = checklist.split("\n").slice(-10);

    // 2️⃣ Шукаємо зелені деплої (успішні)
    const greens = lines.filter(l => /зелен|success|ok/i.test(l));

    // 3️⃣ Формуємо короткий звіт
    const report = {
      ok: true,
      total_archives: archives.length,
      last_logs: lines,
      green_deploys: greens.length,
      last_green: greens.at(-1) || "—",
    };

    return json(report);
  }

  return null;
}