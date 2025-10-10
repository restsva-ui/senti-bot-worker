// src/routes/aiEvolve.js
// Порівняння версій "мозку" + авто-промоут. Усі внутрішні запити з ?s=WEBHOOK_SECRET.

import { listArchives, appendChecklist } from "../lib/kvChecklist.js";
import { abs } from "../utils/url.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const withSec = (env, path) => {
  const s = env.WEBHOOK_SECRET || "";
  const sep = path.includes("?") ? "&" : "?";
  return abs(env, `${path}${s ? `${sep}s=${encodeURIComponent(s)}` : ""}`);
};

async function safeJson(url, init) {
  try {
    const r = await fetch(url, init);
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

export async function handleAiEvolve(req, env, url) {
  const p = url.pathname;

  // GET /ai/evolve/run — бере 2 останні архіви і записує коротке резюме у чеклист
  if (p === "/ai/evolve/run" && req.method === "GET") {
    const items = await listArchives(env);
    if (items.length < 2) {
      return json({ ok: false, error: "not_enough_archives", total: items.length }, 400);
    }
    const [current, previous] = [items[0], items[1]]; // від новішого до старішого

    const msg =
      `🧠 evolution: ${previous} > ${current}`;
    await appendChecklist(env, msg);

    return json({
      ok: true,
      message: "evolution summary saved",
      compared: { previous, current },
    });
  }

  // GET /ai/evolve/auto — selftest → promote (найновіший архів)
  if (p === "/ai/evolve/auto" && req.method === "GET") {
    // 1) selftest з секретом
    const st = await safeJson(withSec(env, "/selftest/run"));
    const stOk = !!st.ok && !!st.data?.ok;

    // 2) список архівів
    const items = await listArchives(env);
    if (!items.length) {
      await appendChecklist(env, `❌ auto-promote skipped — no archives`);
      return json({ ok: false, error: "no_archives" }, 400);
    }

    // 3) promote найновішого
    const key = items[0];
    const pr = await safeJson(withSec(env, `/api/brain/promote?key=${encodeURIComponent(key)}`));

    const emoji = pr.ok ? "🧠" : "⚠️";
    await appendChecklist(
      env,
      `${emoji} auto-promote ${pr.ok ? "success" : "fail"} → ${key}` +
        (stOk ? "" : " (selftest:fail)")
    );

    return json({
      ok: pr.ok,
      selftest_ok: stOk,
      promoted: pr.data?.promoted || key,
      status: pr.status,
    }, pr.ok ? 200 : 500);
  }

  return null;
}