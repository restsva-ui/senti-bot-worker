// src/routes/adminEditor.js
import { html, json } from "../utils/http.js";

function isAllowed(env, url) {
  if (!env.WEBHOOK_SECRET) return true;
  return url.searchParams.get("s") === env.WEBHOOK_SECRET;
}

function pickKV(env, ns) {
  const t = String(ns || "").toUpperCase();
  if (t === "CODE") return env.CODE_KV;
  if (t === "ARCHIVE") return env.ARCHIVE_KV;
  if (t === "STATE") return env.STATE_KV;
  return env.CODE_KV || env.STATE_KV || env.ARCHIVE_KV || null;
}

export async function handleAdminEditor(req, env, url) {
  const p = url.pathname;

  if (!p.startsWith("/admin/editor")) return json({ ok:false, error:"not found" }, 404);

  if (p === "/admin/editor" && req.method === "GET") {
    if (!isAllowed(env, url)) return html("<h3>401</h3> unauthorized");
    const s = url.searchParams.get("s") || "";
    return html(`<!doctype html>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>KV Editor</title>
<style>
  body{font:14px/1.4 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu,sans-serif;padding:12px;background:#0b0b0b;color:#e6e6e6}
  a{color:#7dd3fc;text-decoration:none}
  header{display:flex;align-items:center;gap:12px;margin-bottom:10px}
  .btn{display:inline-block;padding:10px 14px;border-radius:12px;border:1px solid #2a2a2a;background:#111}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
  input,select,button,textarea{background:#0d0d0d;color:#eaeaea;border:1px solid #2a2a2a;border-radius:10px;padding:10px}
  textarea{width:100%;height:55vh;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  ul{list-style:none;padding-left:0}
  li{padding:4px 0;border-bottom:1px dashed #222;cursor:pointer}
  .muted{opacity:.75}
  .ok{color:#6ee7a8}.err{color:#fda4af}
</style>
<header>
  <a class="btn" href="/admin/checklist?s=${encodeURIComponent(s)}">← До Checklist</a>
  <h1 style="margin:0">KV Editor</h1>
  <span class="muted">browser-only</span>
</header>
<main class="wrap">
  <div class="row">
    <label>Namespace:
      <select id="ns">
        <option value="STATE">STATE_KV</option>
        <option value="ARCHIVE">ARCHIVE_KV</option>
        <option value="CODE">CODE_KV</option>
      </select>
    </label>
    <label style="display:flex;align-items:center;gap:6px">
      <input type="checkbox" id="raw"> <span>raw key (не додавати "code:")</span>
    </label>
    <input id="prefix" placeholder="prefix (optional)">
    <button id="btnList">List</button>
  </div>

  <div class="row">
    <input id="key" placeholder="key (напр. code:test.txt)">
    <button id="btnLoad">Load</button>
    <button id="btnNew">New</button>
    <button id="btnSave">Save</button>
    <span id="status" class="muted"></span>
  </div>

  <textarea id="val" placeholder="value (JSON/string)"></textarea>

  <p class="muted" style="margin-top:10px">
    Порада: API сумісні з редактором —
    <code>/admin/api/list?ns=&amp;prefix=&amp;raw=0</code>,
    <code>/admin/api/get?ns=&amp;path=&amp;raw=0</code>,
    <code>/admin/api/put?ns=&amp;path=&amp;raw=0</code> (POST з сирим тілом).<br/>
    Якщо <code>raw=0</code>, то ключі автоматично нормалізуються до <code>code:*</code>.
  </p>

  <h3>Keys</h3>
  <ul id="keys"></ul>
</main>

<script>
const secret = ${JSON.stringify(s)};

const $ = (id)=>document.getElementById(id);
const status = (t, cls="muted")=>{ const el=$("status"); el.className=cls; el.textContent=t; };

async function api(path, params={}, body=null, method) {
  const u = new URL(path, location.origin);
  u.searchParams.set("s", secret);
  for (const [k,v] of Object.entries(params||{})) if (v!=null) u.searchParams.set(k, v);
  const opt = { method: method || (body? "POST":"GET") };
  if (body){ opt.body = body; }
  const r = await fetch(u, opt);
  return await r.json();
}

async function listKeys(){
  status("Loading list…");
  const d = await api("/admin/api/list", {
    ns: $("ns").value,
    prefix: $("prefix").value.trim(),
    raw: $("raw").checked ? "1" : "0",
  });
  const ul = $("keys"); ul.innerHTML="";
  for(const k of (d.items||[])){
    const li = document.createElement("li");
    li.textContent = typeof k === "string" ? k : (k.key || "");
    li.onclick=()=>{ $("key").value = (typeof k === "string" ? k : (k.key||"")); loadKey(); };
    ul.appendChild(li);
  }
  status("Loaded " + (d.items||[]).length + " keys.", "ok");
}

async function loadKey(){
  const key = $("key").value.trim();
  if (!key) return;
  status("Loading…");
  const d = await api("/admin/api/get", {
    ns: $("ns").value,
    path: key,
    raw: $("raw").checked ? "1" : "0",
  });
  $("val").value = d?.value ?? "";
  status("Loaded.", "ok");
}

async function saveKey(){
  const key = $("key").value.trim();
  const val = $("val").value;
  if (!key) return;
  status("Saving…");
  const u = new URL("/admin/api/put", location.origin);
  u.searchParams.set("s", secret);
  u.searchParams.set("ns", $("ns").value);
  u.searchParams.set("path", key);
  u.searchParams.set("raw", $("raw").checked ? "1" : "0");
  const r = await fetch(u, { method: "POST", body: val });
  const d = await r.json();
  status(d?.ok ? "Saved." : (d?.error || "Save error"), d?.ok ? "ok" : "err");
}

$("btnList").onclick = listKeys;
$("btnLoad").onclick = loadKey;
$("btnSave").onclick = saveKey;
$("btnNew").onclick = ()=>{ $("val").value=""; $("key").focus(); };

</script>
`);
  }

  // JSON API
  if (p === "/admin/editor/api/list") {
    if (!isAllowed(env, url)) return json({ ok:false, error:"unauthorized" }, 401);
    const ns = url.searchParams.get("ns");
    const kv = pickKV(env, ns);
    const prefix = url.searchParams.get("prefix") || "";
    const { keys=[] } = (await kv.list({ prefix })) || {};
    return json({ ok:true, items: keys.map(k=>k.name) });
  }

  if (p === "/admin/editor/api/get") {
    if (!isAllowed(env, url)) return json({ ok:false, error:"unauthorized" }, 401);
    const ns = url.searchParams.get("ns");
    const key = url.searchParams.get("key") || "";
    const kv = pickKV(env, ns);
    const value = await kv.get(key, "text");
    return json({ ok:true, key, value });
  }

  if (p === "/admin/editor/api/put" && req.method === "POST") {
    if (!isAllowed(env, url)) return json({ ok:false, error:"unauthorized" }, 401);
    const body = await req.json().catch(()=>null);
    const kv = pickKV(env, body?.ns);
    const key = String(body?.key||"").trim();
    const value = String(body?.value ?? "");
    if (!key) return json({ ok:false, error:"key required" }, 400);
    await kv.put(key, value);
    return json({ ok:true });
  }

  return json({ ok:false, error:"not found" }, 404);
}