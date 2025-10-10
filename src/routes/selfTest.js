// src/routes/selfTest.js
// Швидкі перевірки сервісу. Додає ?s=WEBHOOK_SECRET до внутрішніх викликів.

import { appendChecklist } from "../lib/kvChecklist.js";
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

async function ping(url) {
  try {
    const r = await fetch(url, { method: "GET" });
    return { ok: r.ok, status: r.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function handleSelfTest(req, env, url) {
  const p = url.pathname;

  // GET /selftest/run — виконує набір перевірок
  if (p === "/selftest/run" && req.method === "GET") {
    // формуємо цілі
    const targets = {
      health: withSec(env, "/health"),
      webhook_get: withSec(env, "/webhook"),
      brain_current: withSec(env, "/api/brain/current"),
      brain_list: withSec(env, "/api/brain/list"),
      admin_checklist_html: withSec(env, "/admin/checklist/html"),
      admin_repo_html: withSec(env, "/admin/repo/html"),
      admin_statut_html: withSec(env, "/admin/statut/html"),
    };

    // виконуємо паралельно
    const entries = await Promise.all(
      Object.entries(targets).map(async ([name, u]) => {
        const r = await ping(u);
        return [name, { name, ...r }];
      })
    );
    const results = Object.fromEntries(entries);

    // compact summary
    const parts = Object.values(results).map(
      (r) => `${r.name}:${r.ok ? "ok" : "fail"}(${r.status})`
    );
    const allOk = Object.values(results).every((r) => r.ok);
    const line =
      `${allOk ? "✅" : "❌"} selftest ${new Date().toISOString()} :: ` +
      parts.join(" | ");

    await appendChecklist(env, line);

    return json({ ok: allOk, results, checklist_line: line });
  }

  // (опційно) /selftest/compact — короткий статус
  if (p === "/selftest/compact" && req.method === "GET") {
    const r = await fetch(withSec(env, "/selftest/run"));
    const d = await r.json().catch(() => ({}));
    return json({ ok: !!d.ok, line: d.checklist_line || "n/a" }, r.status);
  }

  return null;
}