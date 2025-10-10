import { appendChecklist } from "../lib/kvChecklist.js";
import { abs } from "../utils/url.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// формує посилання через abs(env, path), без повтору selftest/run
const mkLink = (env, path) => {
  const s = env.WEBHOOK_SECRET || "";
  const base = abs(env, path);
  return s ? `${base}${base.includes("?") ? "&" : "?"}s=${encodeURIComponent(s)}` : base;
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
    const targets = {
      health: mkLink(env, "/health"),
      webhook_get: mkLink(env, "/webhook"),
      brain_current: mkLink(env, "/api/brain/current"),
      brain_list: mkLink(env, "/api/brain/list"),
      admin_checklist_html: mkLink(env, "/admin/checklist/html"),
      admin_repo_html: mkLink(env, "/admin/repo/html"),
      admin_statut_html: mkLink(env, "/admin/statut/html"),
    };

    const results = {};
    for (const [name, link] of Object.entries(targets)) {
      results[name] = { name, ...(await ping(link)) };
    }

    const parts = Object.values(results).map(
      (r) => `${r.name}:${r.ok ? "ok" : "fail"}(${r.status})`
    );
    const allOk = Object.values(results).every((r) => r.ok);

    const line = `${allOk ? "✅" : "❌"} selftest ${new Date().toISOString()} :: ${parts.join(" | ")}`;
    await appendChecklist(env, line);

    return json({ ok: allOk, results, checklist_line: line });
  }

  return null;
}