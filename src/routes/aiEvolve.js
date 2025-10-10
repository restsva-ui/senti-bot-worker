// src/routes/aiEvolve.js
// Порівняння двох останніх "мозків" + автопромоут при успішному selftest.

import { listArchives, appendChecklist } from "../lib/kvChecklist.js";
import { abs } from "../utils/url.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const needSecret = (env, url) =>
  env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

const CUR_KEY = "brain:current";

// Витягуємо 2 найсвіжіші архіви (latest, previous)
async function latestTwo(env) {
  const items = await listArchives(env); // очікуємо масив рядків ключів
  if (!Array.isArray(items) || items.length < 1) {
    return { latest: null, previous: null, items: [] };
  }
  // масив повертається вже від нового до старого; перестрахуємось сортуванням
  const sorted = [...items].sort((a, b) => (a > b ? -1 : 1));
  return { latest: sorted[0] || null, previous: sorted[1] || null, items: sorted };
}

// Псевдо-аналіз: записуємо службовий рядок у чеклист
async function saveEvolutionNote(env, latest, previous, extra = "") {
  const line = `evolve compare :: latest=${latest || "-"} prev=${previous || "-"} ${extra}`.trim();
  await appendChecklist(env, line);
}

export async function handleAiEvolve(req, env, url) {
  const p = url.pathname;

  // ------- /ai/evolve/run ---------------
  // Порівняти два останніх архіви і зберегти службовий запис
  if (p === "/ai/evolve/run" && req.method === "GET") {
    if (needSecret(env, url)) return json({ ok: false, error: "unauthorized" }, 401);

    const { latest, previous } = await latestTwo(env);
    if (!latest || !previous) {
      return json({ ok: false, error: "not_enough_archives" }, 400);
    }

    await saveEvolutionNote(env, latest, previous, "| summary=saved");
    return json({
      ok: true,
      message: "evolution summary saved",
      compared: { previous, current: latest },
    });
  }

  // ------- /ai/evolve/auto --------------
  // 1) Порівняти архіви
  // 2) Прогнати selftest
  // 3) Якщо selftest ok — виставити latest як brain:current
  if (p === "/ai/evolve/auto" && req.method === "GET") {
    if (needSecret(env, url)) return json({ ok: false, error: "unauthorized" }, 401);

    const { latest, previous } = await latestTwo(env);
    if (!latest || !previous) {
      return json({ ok: false, error: "not_enough_archives" }, 400);
    }

    // 1) Збережемо службову помітку про порівняння
    await saveEvolutionNote(env, latest, previous, "| mode=auto");

    // 2) SelfTest (викликаємо локально з секретом)
    const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
    const selfUrl = abs(env, `/selftest/run?s=${s}`);
    let selfOk = false;
    try {
      const r = await fetch(selfUrl, { method: "GET" });
      const d = await r.json();
      selfOk = !!d?.ok;
      await appendChecklist(env, `selftest:auto result=${selfOk ? "ok" : "fail"}`);
    } catch (e) {
      await appendChecklist(env, `selftest:auto error=${String(e)}`);
      return json({ ok: false, error: "selftest_error" }, 500);
    }

    if (!selfOk) {
      return json({
        ok: false,
        promoted: null,
        reason: "selftest_failed",
        compared: { previous, latest },
      }, 409);
    }

    // 3) Промоут latest як активний мозок
    await env.CHECKLIST_KV.put(CUR_KEY, latest);
    await appendChecklist(env, `autopromote: ${latest}`);

    return json({
      ok: true,
      promoted: latest,
      compared: { previous, latest },
      note: "auto-promote after successful selftest",
    });
  }

  return null;
}