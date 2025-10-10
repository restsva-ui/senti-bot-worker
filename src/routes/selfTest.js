// src/routes/selfTest.js
import { appendChecklist } from "../lib/kvChecklist.js";
import { abs } from "../utils/url.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// будуємо абсолютні посилання з секретом
const mkLink = (env, path) => {
  const base = abs(env, path);
  const s = env.WEBHOOK_SECRET || "";
  const u = new URL(base);
  if (s) u.searchParams.set("s", s);
  return u.toString();
};

async function ping(url) {
  try {
    const r = await fetch(url, { method: "GET" });
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }
}

export async function handleSelfTest(req, env, url) {
  if (url.pathname !== "/selftest/run" || req.method !== "GET") return null;

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
    results[name] = { name, url: link, ...(await ping(link)) };
  }

  const allOk = Object.values(results).every(r => r.ok);
  const parts = Object.values(results).map(
    r => `${r.name}:${r.ok ? "ok" : "fail"}(${r.status})`
  );

  const line =
    `${allOk ? "✅" : "❌"} selftest ${new Date().toISOString()} :: ` +
    parts.join(" | ");

  await appendChecklist(env, line);

  return json({ ok: allOk, results, checklist_line: line });
}