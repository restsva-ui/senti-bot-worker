// src/routes/adminLearn.js
import { enqueueLearn, listQueued, runLearnOnce, getLastSummary } from "../lib/kvLearnQueue.js";
import { abs } from "../utils/url.js";

// ——— Заголовки/утиліти ————————————————————————————————————————————————————
const HTML = { "content-type": "text/html; charset=utf-8" };
const JSONH = { "content-type": "application/json; charset=utf-8" };

function okJson(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), { status, headers: JSONH });
}
function bad(msg = "bad request", status = 400) {
  return okJson({ ok: false, error: String(msg) }, status);
}

function secretFromEnv(env) {
  return env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET || "";
}
function isAuthorized(url, env) {
  const sec = url.searchParams.get("s") || "";
  const need = secretFromEnv(env);
  return !!need && sec === need;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function pageHtml(env, url, { canWrite, lastSummary }) {
  const self = abs(env, "/admin/learn/html");
  const secQS = canWrite ? `?s=${encodeURIComponent(secretFromEnv(env))}` : "";
  const enqueueUrl = abs(env, `/admin/learn/enqueue${secQS}`);
  const runUrl = abs(env, `/admin/learn/run${secQS}`);
  const queueJson = abs(env, `/admin/learn/queue.json${secQS}`);
  const summaryJson = abs(env, `/admin/learn/summary.json${secQS}`);

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Learn • Senti</title>
<style>
  :root { --bg:#0b0d10; --fg:#e6e9ee; --muted:#9aa3af; --card:#111418; --acc:#3b82f6; --ok:#16a34a; --warn:#f59e0b; --err:#ef4444; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font: 15px/1.4 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; }
  header { padding:16px; border-bottom:1px solid #1b1f24; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
  .title { font-weight:700; font-size:18px; }
  .badge { padding:4px 8px; border-radius:999px; font-size:12px; background:#1b1f24; color:var(--muted); }
  main { padding:16px; display:grid; gap:16px; grid-template-columns:1fr; }
  @media(min-width:880px){ main{ grid-template-columns: 1.2fr 1fr; } }
  .card { background:var(--card); border:1px solid #1b1f24; border-radius:12px; padding:16px; }
  h2 { margin:0 0 10px 0; font-size:16px; }
  form .row { display:flex; gap:8px; flex-wrap:wrap; }
  input[type="url"], textarea { width:100%; padding:10px 12px; border-radius:10px; border:1px solid #222831; background:#0e1116; color:var(--fg); }
  textarea { min-height:80px; resize:vertical; }
  button { padding:10px 14px; border-radius:10px; border:1px solid #1b1f24; background:var(--acc); color:white; cursor:pointer; font-weight:600; }
  button.secondary { background:#1b1f24; color:var(--fg); }
  button:disabled { opacity:.6; cursor:not-allowed; }
  .grid { display:grid; gap:8px; }
  .item { padding:10px; border:1px solid #1b1f24; border-radius:10px; background:#0e1116; }
  .muted { color:var(--muted); }
  .ok { color:var(--ok); } .warn{ color:var(--warn);} .err{ color:var(--err); }
  .hint { font-size:13px; color:var(--muted); }
  .row-actions { display:flex; gap:8px; flex-wrap:wrap; }
  .link { color:#93c5fd; text-decoration:none; }
</style>
</head>
<body>
<header>
  <div class="title">🧠 Learn</div>
  ${canWrite ? `<span class="badge">admin</span>` : `<span class="badge">read-only</span>`}
  <span class="badge">host: ${esc(env.SERVICE_HOST || "workers.dev")}</span>
</header>

<main>
  <section class="card">
    <h2>Додати матеріали</h2>
    <p class="hint">Встав посилання на статтю/відео/файл/архів (Google Drive, Dropbox, пряма URL). У Telegram можна надсилати і самі файли — вони також летять у чергу.</p>
    <form id="f-enq" method="post" action="${enqueueUrl}">
      <div class="grid">
        <input type="url" name="url" placeholder="https://..." required ${canWrite ? "" : "disabled"} />
        <textarea name="note" placeholder="Короткий опис (опц.)" ${canWrite ? "" : "disabled"}></textarea>
        <div class="row row-actions">
          <button ${canWrite ? "" : "disabled"}>Додати у чергу</button>
          <button type="button" id="btn-run" class="secondary" ${canWrite ? "" : "disabled"}>Запустити зараз</button>
          <a class="link" href="${self}">Оновити сторінку</a>
        </div>
      </div>
    </form>
    <div id="enq-status" class="hint"></div>
  </section>

  <section class="card">
    <h2>Останній звіт</h2>
    <pre id="summary" class="item" style="white-space:pre-wrap">${esc(lastSummary || "—")}</pre>
  </section>

  <section class="card">
    <h2>Черга</h2>
    <div id="queue" class="grid"></div>
  </section>
</main>

<script>
async function fetchJSON(u){ const r = await fetch(u, { cache:"no-store" }); return r.json(); }
async function reloadSummary(){ try{
  const d = await fetchJSON("${summaryJson}");
  document.getElementById("summary").textContent = d?.summary || "—";
}catch{}}
async function reloadQueue(){ try{
  const d = await fetchJSON("${queueJson}");
  const list = Array.isArray(d?.items) ? d.items : [];
  const root = document.getElementById("queue");
  root.innerHTML = "";
  if(!list.length){ root.innerHTML = '<div class="item muted">Черга порожня</div>'; return; }
  for(const it of list){
    const el = document.createElement("div");
    el.className="item";
    const src = it?.payload?.url || it?.payload?.name || it?.id;
    el.innerHTML = "<div><b>"+(it.kind || "item")+"</b> — "+(src || "")+"</div><div class='muted'>"+(it.at || "")+"</div>";
    root.appendChild(el);
  }
}catch{}}

document.getElementById("btn-run")?.addEventListener("click", async ()=>{
  try{
    document.getElementById("btn-run").disabled = true;
    const r = await fetch("${runUrl}", { method:"POST" });
    const d = await r.json().catch(()=>null);
    document.getElementById("enq-status").textContent = d?.summary || (d?.ok ? "OK" : "Помилка");
    await reloadSummary(); await reloadQueue();
  }finally{
    document.getElementById("btn-run").disabled = false;
  }
});

document.getElementById("f-enq")?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  try{
    const r = await fetch(form.action, { method:"POST", body: fd });
    const d = await r.json().catch(()=>null);
    document.getElementById("enq-status").textContent = d?.ok ? "✅ Додано" : ("❌ " + (d?.error || "Помилка"));
    form.reset();
    await reloadQueue();
  }catch(err){
    document.getElementById("enq-status").textContent = "❌ Помилка мережі";
  }
});

(async()=>{ await reloadSummary(); await reloadQueue(); })();
</script>
</body>
</html>`;
}
export async function handleAdminLearn(req, env, url) {
  const p = url.pathname || "";
  const method = req.method.toUpperCase();
  const canWrite = isAuthorized(url, env);

  // HTML UI
  if (p === "/admin/learn/html") {
    const lastSummary = await getLastSummary(env).catch(() => "");
    return new Response(pageHtml(env, url, { canWrite, lastSummary }), { status: 200, headers: HTML });
  }

  // API: summary.json
  if (p === "/admin/learn/summary.json") {
    if (!canWrite) {
      // читати останній звіт можна й без секрету (щоб вбудовувати у чекліст), при бажанні — закрити.
      const summary = await getLastSummary(env).catch(() => "");
      return okJson({ ok: true, summary });
    }
    const summary = await getLastSummary(env).catch(() => "");
    return okJson({ ok: true, summary });
  }

  // API: queue.json
  if (p === "/admin/learn/queue.json") {
    // показ черги дозволимо без секрету (read-only), можна посилити при потребі
    const items = await listQueued(env, { limit: 100 }).catch(() => []);
    return okJson({ ok: true, items });
  }

  // API: enqueue (POST, requires secret)
  if (p === "/admin/learn/enqueue") {
    if (!canWrite) return bad("unauthorized", 401);
    if (method !== "POST") return bad("method not allowed", 405);
    let urlStr = "", note = "", userId = url.searchParams.get("u") || "admin";
    try {
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const body = await req.json();
        urlStr = String(body?.url || "").trim();
        note = String(body?.note || "").trim();
      } else {
        const fd = await req.formData();
        urlStr = String(fd.get("url") || "").trim();
        note = String(fd.get("note") || "").trim();
      }
      if (!/^https?:\/\//i.test(urlStr)) return bad("invalid url");
      const res = await enqueueLearn(env, String(userId), { url: urlStr, name: note || urlStr });
      return okJson({ ok: true, enqueued: res });
    } catch (e) {
      return bad(String(e?.message || e), 500);
    }
  }

  // API: run (POST/GET, requires secret)
  if (p === "/admin/learn/run") {
    if (!canWrite) return bad("unauthorized", 401);
    if (!["POST", "GET"].includes(method)) return bad("method not allowed", 405);
    try {
      const res = await runLearnOnce(env, {});
      return okJson({ ok: true, ...res });
    } catch (e) {
      return bad(String(e?.message || e), 500);
    }
  }

  // 404
  return new Response("Not found", { status: 404 });
}
