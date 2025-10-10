// src/routes/selfTest.js
import { appendChecklist } from "../lib/kvChecklist.js";
import { html, json } from "../utils/respond.js";
import { abs } from "../utils/url.js";

const needSecret = (env, url) =>
  env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

async function ping(url) {
  try {
    const r = await fetch(url, { method: "GET" });
    const ct = r.headers.get("content-type") || "";
    const body = await (ct.includes("application/json") ? r.json().catch(()=> ({})) : r.text());
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: String(e) };
  }
}

export async function handleSelfTest(req, env, url) {
  const p = url.pathname;

  // HTML UI
  if (p === "/selftest/html") {
    if (needSecret(env, url)) return html("<h3>401</h3>");
    const runLink = abs(env, `/selftest/run?s=${encodeURIComponent(env.WEBHOOK_SECRET || "")}`);
    return html(`<!doctype html><meta charset="utf-8">
    <title>Senti SelfTest</title>
    <style>
      body{font-family:system-ui;margin:20px;line-height:1.45}
      .ok{color:#0a0}
      .bad{color:#c00}
      a.button{display:inline-block;padding:8px 12px;border:1px solid #ccc;border-radius:10px;text-decoration:none}
    </style>
    <h2>🧪 Senti SelfTest</h2>
    <p><a class="button" href="${runLink}">Запустити перевірку зараз</a></p>
    <p>Результат буде також занесено у чеклист.</p>`);
  }

  // RUN
  if (p === "/selftest/run") {
    if (needSecret(env, url)) return json({ ok:false, error:"unauthorized" }, 401);

    const host = env.SERVICE_HOST;
    const sec  = encodeURIComponent(env.WEBHOOK_SECRET || "");
    const withS = (path, hasQuery=false) => {
      const base = `https://${host}${path}`;
      if (!env.WEBHOOK_SECRET) return base;
      return base + (hasQuery ? "&" : "?") + `s=${sec}`;
    };

    // ——— Тести (GET)
    const endpoints = [
      { name:"health",        url: `https://${host}/health` },
      { name:"webhook_get",   url: `https://${host}/webhook` },
      { name:"brain_current", url: `https://${host}/api/brain/current` },
      { name:"brain_list",    url: withS(`/api/brain/list`, false) },
      { name:"admin_checklist_html", url: withS(`/admin/checklist/html`, false) },
      { name:"admin_repo_html",      url: withS(`/admin/repo/html`, false) },
      { name:"admin_statut_html",    url: withS(`/admin/statut/html`, false) },
    ];

    // 1) прості пінги
    const results = [];
    for (const ep of endpoints) {
      const r = await ping(ep.url);
      results.push({ name: ep.name, ok: r.ok, status: r.status });
    }

    // 2) якщо є хоча б один архів — перевірити скачування binary
    let dlCheck = { name: "repo_download_sample", ok: false, status: 0 };
    try {
      const listResp = await ping(withS(`/api/brain/list`, false));
      const items = listResp?.body?.items || [];
      if (Array.isArray(items) && items.length) {
        const key = encodeURIComponent(items[0]);
        const getUrl = withS(`/admin/archive/get?key=${key}`, true);
        const r = await fetch(getUrl);
        dlCheck.ok = r.ok;
        dlCheck.status = r.status;
      } else {
        dlCheck = { name: "repo_download_sample", ok: true, status: 204 }; // немає архівів — не помилка
      }
    } catch (e) {
      dlCheck = { name: "repo_download_sample", ok: false, status: 0 };
    }
    results.push(dlCheck);

    // Підсумок
    const allOk = results.every(r => r.ok);
    const stamp = new Date().toISOString();
    const line  = `${allOk ? "✅" : "❌"} selftest ${stamp} :: ` +
                  results.map(r => `${r.name}:${r.ok ? "ok" : "fail"}(${r.status})`).join(" | ");

    // Запис у чеклист
    try { await appendChecklist(env, line); } catch {}

    // Відповідь у JSON + легкий HTML у разі відкриття в браузері
    const details = results.reduce((acc, r) => ({ ...acc, [r.name]: r }), {});
    return json({ ok: allOk, results: details, checklist_line: line });
  }

  return null;
}