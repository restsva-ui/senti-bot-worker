// src/routes/selfTest.js
import { appendChecklist } from "../lib/kvChecklist.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// Будуємо абсолютні посилання ВІД поточного origin і підклеюємо секрет
const withSecFrom = (env, baseOrigin, path) => {
  const u = new URL(path, baseOrigin);
  const s = env.WEBHOOK_SECRET || "";
  if (s) u.searchParams.set("s", s);
  return u.toString();
};

async function ping(href) {
  try {
    const r = await fetch(href, { method: "GET" });
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

export async function handleSelfTest(req, env, url) {
  if (url.pathname !== "/selftest/run" || req.method !== "GET") return null;

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

  const results = {};
  await Promise.all(
    Object.entries(targets).map(async ([name, href]) => {
      results[name] = { name, url: href, ...(await ping(href)) };
    })
  );

  const allOk = Object.values(results).every((r) => r.ok);
  const parts = Object.values(results).map(
    (r) => `${r.name}:${r.ok ? "ok" : "fail"}(${r.status || "ERR"})`
  );

  const line =
    `${allOk ? "✅" : "❌"} selftest ${new Date().toISOString()} :: ` +
    parts.join(" | ");

  await appendChecklist(env, line);

  const summary = parts.join(" | ");

  return json({
    ok: allOk,
    summary,
    results,
    origin: url.origin,
    secured: !!env.WEBHOOK_SECRET,
    checklist_line: line,
  });
}