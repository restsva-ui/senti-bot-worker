// src/routes/selfTest.js
import { appendChecklist } from "../lib/kvChecklist.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// Будуємо абсолютні посилання ВІД поточного origin
const withSecFrom = (env, baseUrl, path) => {
  const s = env.WEBHOOK_SECRET || "";
  const u = new URL(path, baseUrl); // ← базуємось на url.origin
  if (s) u.searchParams.set("s", s);
  return u.toString();
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

  if (p === "/selftest/run" && req.method === "GET") {
    const mk = (path) => withSecFrom(env, url.origin, path);

    const targets = {
      health: mk("/health"),
      webhook_get: mk("/webhook"),
      brain_current: mk("/api/brain/current"),
      brain_list: mk("/api/brain/list"),
      admin_checklist_html: mk("/admin/checklist/html"),
      admin_repo_html: mk("/admin/repo/html"),
      admin_statut_html: mk("/admin/statut/html"),
    };

    const entries = await Promise.all(
      Object.entries(targets).map(async ([name, u]) => {
        const r = await ping(u);
        return [name, { name, ...r }];
      })
    );
    const results = Object.fromEntries(entries);

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

  return null;
}