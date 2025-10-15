// src/routes/admin-kv.js
// Прості та надійні ендпоінти для KV: UI + list/get/put.
// Працює з кількома KV: STATE_KV, CODE_KV, CHECKLIST_KV.
// Захист: ?s=WEBHOOK_SECRET (env.WEBHOOK_SECRET)

function requireSecret(url, env) {
  const got = url.searchParams.get("s") || "";
  const need = env?.WEBHOOK_SECRET || "";
  return need && got && got === need;
}

function pickNS(env, nsName) {
  const map = {
    "STATE_KV": env?.STATE_KV,
    "CODE_KV": env?.CODE_KV,
    "CHECKLIST_KV": env?.CHECKLIST_KV,
  };
  return map[nsName] || null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function html(body) {
  return new Response(body, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function esc(s = "") {
  return String(s).replace(/[&<>"]/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"':'&quot;' }[m]));
}

// -------- UI --------
function uiPage(url, env) {
  const ns = url.searchParams.get("ns") || "STATE_KV";
  const sec = url.searchParams.get("s") || "";
  const backHref = `/admin/checklist${sec ? `?s=${encodeURIComponent(sec)}` : ""}`;
  const nsOptions = ["STATE_KV", "CODE_KV", "CHECKLIST_KV"]
    .map(n => `<option ${n===ns?"selected":""} value="${n}">${n}</option>`).join("");

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>KV Editor</title>
<style>
  body{font:14px/1.45 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu,sans-serif;background:#0b0b0b;color:#e6e6e6;margin:0;padding:16px}
  .wrap{max-width:900px;margin:0 auto}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0}
  select,input,textarea,button{background:#0f1115;color:#e6e6e6;border:1px solid #2a2a2a;border-radius:12px;padding:10px}
  textarea{width:100%;min-height:260px;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace}
  button{cursor:pointer}
  a{color:#7dd3fc;text-decoration:none}
  .btn{background:#1f2937;border:1px solid #334155;border-radius:12px;padding:10px 14px;display:inline-flex;gap:8px;align-items:center}
</style>
</head>
<body>
<div class="wrap">
  <h1>KV Editor · <code>${esc(ns)}</code> <a class="btn" href="${backHref}">← До Checklist</a></h1>

  <div class="row">
    <label>Namespace:
      <select id="ns">
        ${nsOptions}
      </select>
    </label>
    <a class="btn" id="openHere">Відкрити</a>
  </div>

  <div class="row">
    <input id="prefix" placeholder="prefix (optional)" style="flex:1"/>
    <button id="btnList">List</button>
  </div>

  <div class="row">
    <input id="key" placeholder="key" style="flex:1"/>
  </div>

  <div class="row">
    <button id="btnLoad">Load</button>
    <button id="btnNew">New</button>
    <button id="btnSave">Save</button>
  </div>

  <textarea id="value" placeholder="value (JSON/string)"></textarea>

  <p style="opacity:.7">Порада: Save робить <code>POST</code> на <code>/admin/kv/put?ns=&key=&s=...</code> із сирим тілом.</p>
</div>

<script>
(function(){
  const SECRET = ${JSON.stringify(sec)};
  const nsSel = document.getElementById('ns');
  const openHere = document.getElementById('openHere');
  const prefix = document.getElementById('prefix');
  const key = document.getElementById('key');
  const value = document.getElementById('value');

  function build(base, params){
    const u = new URL(base, location.origin);
    for(const [k,v] of Object.entries(params)) if (v!==undefined && v!=="") u.searchParams.set(k,v);
    return u.toString();
  }

  openHere.addEventListener('click', ()=>{
    location.href = build('/admin/kv', { ns: nsSel.value, s: SECRET });
  });

  document.getElementById('btnList').addEventListener('click', async ()=>{
    const u = build('/admin/kv/list', { ns: nsSel.value, prefix: prefix.value, s: SECRET });
    const r = await fetch(u);
    value.value = await r.text();
  });

  document.getElementById('btnLoad').addEventListener('click', async ()=>{
    const u = build('/admin/kv/get', { ns: nsSel.value, key: key.value, s: SECRET });
    const r = await fetch(u);
    value.value = await r.text();
  });

  document.getElementById('btnNew').addEventListener('click', ()=>{
    value.value = "";
  });

  document.getElementById('btnSave').addEventListener('click', async ()=>{
    const u = build('/admin/kv/put', { ns: nsSel.value, key: key.value, s: SECRET });
    const r = await fetch(u, { method:'POST', body: value.value });
    value.value = await r.text();
  });
})();
</script>
</body>
</html>`;
}

// -------- handlers --------
export async function handleAdminKv(request, env) {
  const url = new URL(request.url);

  // UI
  if (url.pathname === "/admin/kv" || url.pathname === "/admin/kv/") {
    if (!requireSecret(url, env)) return json({ ok:false, error:"Forbidden" }, 403);
    return html(uiPage(url, env));
  }

  // API
  if (!requireSecret(url, env)) return json({ ok:false, error:"Forbidden" }, 403);

  // choose namespace
  const nsName = url.searchParams.get("ns") || "STATE_KV";
  const ns = pickNS(env, nsName);
  if (!ns) return json({ ok:false, error:`Unknown namespace '${nsName}'` }, 400);

  // list
  if (url.pathname === "/admin/kv/list") {
    const prefix = url.searchParams.get("prefix") || "";
    const out = [];
    let cursor;
    do {
      const { keys, list_complete, cursor: next } = await ns.list({ prefix, cursor });
      for (const k of (keys || [])) out.push({ key: k.name, ts: k?.expiration || k?.metadata?.ts || undefined });
      cursor = list_complete ? null : next;
    } while (cursor);
    return json({ ok:true, items: out });
  }

  // get
  if (url.pathname === "/admin/kv/get") {
    const key = url.searchParams.get("key") || "";
    if (!key) return json({ ok:false, error:"Missing key" }, 400);
    const value = await ns.get(key); // повертає string або null
    return json({ ok:true, path: key, value });
  }

  // put
  if (url.pathname === "/admin/kv/put") {
    if (request.method !== "POST") return json({ ok:false, error:"Use POST" }, 405);
    const key = url.searchParams.get("key") || "";
    if (!key) return json({ ok:false, error:"Missing key" }, 400);
    const body = await request.text(); // сирий текст
    await ns.put(key, body ?? "");
    return json({ ok:true, path: key, saved: body?.length ?? 0 });
  }

  return json({ ok:false, error:"Not found", path: url.pathname }, 404);
}