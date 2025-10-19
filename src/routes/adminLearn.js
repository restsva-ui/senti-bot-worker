// src/routes/adminLearn.js
import { html, json } from "../lib/utils.js";
import {
  enqueueSystemLearn,
  listLearn,
  listSystemLearn,
  clearLearn,
  markAsProcessing,
  markAsDone,
} from "../lib/kvLearnQueue.js";
import { appendChecklist } from "../lib/kvChecklist.js";

// ────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────
const esc = (s = "") =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** формуємо URL з параметрами, коректно ставлячи ? / & */
function makeUrl(path, params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

// ────────────────────────────────────────────────────────────────────────────
// Легкий процесор черг (плейсхолдер). Під реальний індексер/скрепер
// сюди під’єднаємо виклик у майбутньому.
// ────────────────────────────────────────────────────────────────────────────
async function processLearnQueues(env, { limit = 5 } = {}) {
  const sys = await listSystemLearn(env);
  let processed = 0;

  for (const it of sys.slice(0, limit)) {
    if (it.status === "done") continue;
    await markAsProcessing(env, it.owner || "system", it.id);
    // TODO: реальна обробка (витяг контенту/індексація)
    await markAsDone(env, it.owner || "system", it.id, {
      summary: `Indexed: ${it.name || it.url}`.slice(0, 140),
    });
    processed++;
  }

  if (processed > 0) {
    try {
      await appendChecklist(env, `🧠 learn: processed ${processed} item(s) (manual run)`);
    } catch {}
  }
  return { ok: true, processed };
}

// ────────────────────────────────────────────────────────────────────────────
// HTML
// ────────────────────────────────────────────────────────────────────────────
const page = (env, userId, userItems = [], sysItems = [], lastResult = "") => {
  const fmt = (ts) =>
    ts
      ? new Date(ts).toLocaleString("uk-UA", {
          timeZone: env.TIMEZONE || "Europe/Kyiv",
        })
      : "—";

  const rows =
    userItems
      .map(
        (i) => `
          <tr>
            <td>${esc(i.name || i.url)}</td>
            <td>${esc(i.type || "url")}</td>
            <td>${fmt(i.when)}</td>
            <td>${esc(i.status || "queued")}</td>
          </tr>`
      )
      .join("") || `<tr><td colspan="4">— порожньо —</td></tr>`;

  const srows =
    sysItems
      .map(
        (i) => `
          <tr>
            <td>${esc(i.name || i.url)}</td>
            <td>${esc(i.type || "url")}</td>
            <td>${fmt(i.when)}</td>
            <td>${esc(i.status || "queued")}</td>
          </tr>`
      )
      .join("") || `<tr><td colspan="4">— немає записів —</td></tr>`;

  const secParam = env.WEBHOOK_SECRET ? { s: env.WEBHOOK_SECRET } : {};
  const backHref = makeUrl("/admin/learn/html", secParam);
  const refreshHref = backHref;
  const runHref = makeUrl("/admin/learn/run", secParam);
  const clearHref = makeUrl("/admin/learn/clear", { ...secParam, u: userId || "" });

  return `
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root{
      --bg:#0b0f14;--card:#0f1620;--line:#1f2a36;--muted:#9fb0c3;--txt:#eaf0f7;
      --btn:#1f2a36;--btn2:#2a3a4c;--ok:#22c55e;--warn:#f59e0b;
    }
    *{box-sizing:border-box}
    body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--txt);background:var(--bg);margin:0;padding:16px}
    h1{margin:0 0 12px}
    section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    input[type=text]{flex:1 1 260px;min-width:220px;background:#0b121a;border:1px solid #243243;border-radius:10px;color:var(--txt);padding:10px 12px}
    .btn{display:inline-flex;gap:8px;align-items:center;padding:10px 14px;background:var(--btn);border:1px solid var(--btn2);border-radius:12px;color:var(--txt);text-decoration:none;cursor:pointer}
    .btn--ok{background:#124025;border-color:#146a37}
    .btn--warn{background:#3c2a07;border-color:#6b480a}
    .note{color:var(--muted);margin:8px 0 0}
    .result{margin-top:10px;padding:10px;border-radius:10px;background:#111826;border:1px solid #223148}
    table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;font-size:13px}
    @media (min-width:900px){ body{padding:24px} }
  </style>

  <h1>🧠 Learn (admin)</h1>

  <section>
    <div class="row" style="gap:10px">
      <form method="GET" action="/admin/learn/add" class="row" style="flex:1;gap:8px">
        <input type="hidden" name="s" value="${esc(env.WEBHOOK_SECRET || "")}">
        <input type="text" name="url" placeholder="https:// (стаття / відео / файл)" required />
        <button class="btn" type="submit">Додати в системну чергу</button>
      </form>

      <a class="btn" href="${refreshHref}">Оновити</a>
      <a class="btn btn--ok" href="${runHref}">▶️ Запустити навчання зараз</a>
    </div>
    <p class="note">Автоматичне фонове навчання запускає нічний агент (див. <code>wrangler.toml [triggers]</code>).</p>
    ${lastResult ? `<div class="result">${esc(lastResult)}</div>` : ""}
  </section>

  <section>
    <h2>Твоя черга</h2>
    <table>
      <thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>
      <a class="btn btn--warn" href="${clearHref}">🧹 Очистити мою чергу</a>
      <span class="note">userId=${esc(userId || "(not set)")}</span>
    </p>
  </section>

  <section>
    <h2>Системна черга</h2>
    <table>
      <thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
      <tbody>${srows}</tbody>
    </table>
  </section>
  `;
};

// ────────────────────────────────────────────────────────────────────────────
// ROUTE
// ────────────────────────────────────────────────────────────────────────────
export async function handleAdminLearn(req, env, url) {
  const p = url.pathname;

  // Авторизація
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (p.startsWith("/admin/learn/add")) {
    const itemUrl = (url.searchParams.get("url") || "").trim();
    if (!itemUrl) return json({ ok: false, error: "url required" }, { status: 400 });
    await enqueueSystemLearn(env, { url: itemUrl, name: itemUrl });
    const back = makeUrl("/admin/learn/html", env.WEBHOOK_SECRET ? { s: env.WEBHOOK_SECRET } : {});
    return html(`<p>✅ Додано: ${esc(itemUrl)}</p><p><a href="${back}">Назад</a></p>`);
  }

  if (p.startsWith("/admin/learn/clear")) {
    const u = url.searchParams.get("u");
    if (!u) return json({ ok: false, error: "u required" }, { status: 400 });
    await clearLearn(env, u);
    const back = makeUrl("/admin/learn/html", env.WEBHOOK_SECRET ? { s: env.WEBHOOK_SECRET } : {});
    return html(`<p>🧹 Очищено чергу користувача: ${esc(u)}</p><p><a href="${back}">Назад</a></p>`);
  }

  if (p.startsWith("/admin/learn/run")) {
    const res = await processLearnQueues(env, { limit: 10 }).catch((e) => ({
      ok: false,
      error: String(e && e.message ? e.message : e),
    }));
    const uid = url.searchParams.get("u") || "(not set)";
    const userItems = uid !== "(not set)" ? await listLearn(env, uid) : [];
    const sysItems = await listSystemLearn(env);
    const msg = res.ok ? `OK: processed ${res.processed || 0} item(s)` : `ERR ${res.error || "unknown"}`;
    return html(page(env, uid, userItems, sysItems, msg));
  }

  // HTML / JSON огляди
  const uid = url.searchParams.get("u") || "(not set)";
  const userItems = uid !== "(not set)" ? await listLearn(env, uid) : [];
  const sysItems = await listSystemLearn(env);

  if (p.endsWith("/json")) {
    return json({ ok: true, userId: uid, userItems, sysItems });
  }
  return html(page(env, uid, userItems, sysItems));
}
