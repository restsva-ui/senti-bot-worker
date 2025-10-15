// src/routes/adminEditor.js
import { html, json } from "../utils/http.js";

/** Безпечна перевірка секрету (сумісність із WEBHOOK_SECRET) */
function isAllowed(env, url) {
  const qs = url.searchParams.get("s") || "";
  const secret = String(env.WEBHOOK_SECRET || "").trim();
  return secret && qs === secret;
}

/** Вибір KV за параметром ns (STATE|ARCHIVE), дефолт STATE */
function pickKV(env, ns) {
  const key = String(ns || "STATE").toUpperCase();
  if (key === "ARCHIVE" && env.ARCHIVE_KV) return env.ARCHIVE_KV;
  return env.STATE_KV;
}

export async function handleAdminEditor(req, env, url) {
  const p = url.pathname;

  // ---- HTML UI -------------------------------------------------------------
  if (p === "/admin/editor") {
    if (!isAllowed(env, url)) {
      return html(`<h3>Unauthorized</h3>`, 401);
    }
    const secret = url.searchParams.get("s") || "";
    return html(`<!doctype html>
<meta charset="utf-8"/>
<title>Senti — KV Editor</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  :root{color-scheme:dark}
  body{margin:0;font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:#0f1115;color:#d7e0ea}
  header{padding:12px 16px;border-bottom:1px solid #222;display:flex;gap:12px;align-items:center}
  header h1{font-size:16px;margin:0;font-weight:600}
  main{display:grid;grid-template-columns:280px 1fr;min-height:calc(100vh - 49px)}
  aside{border-right:1px solid #222;overflow:auto}
  .row{display:flex;gap:8px;padding:8px}
  input,select,button,textarea{background:#161a22;color:#d7e0ea;border:1px solid #2a2f3a;border-radius:8px;padding:8px}
  button{cursor:pointer}
  ul{list-style:none;margin:0;padding:0}
  li{padding:10px 12px;border-bottom:1px solid #1f2430;cursor:pointer}
  li:hover{background:#141822}
  .muted{opacity:.7}
  .wrap{padding:10px}
  textarea{width:100%;height:60vh;resize:vertical;font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
  .bar{display:flex;gap:8px;align-items:center;margin:8px 0}
  .ok{color:#6ee7a8}.err{color:#fda4af}
</style>
<header>
  <h1>KV Editor</h1>
  <span class="muted">browser-only</span>
</header>
<main>
  <aside>
    <div class="row">
      <select id="ns">
        <option value="STATE">STATE_KV</option>
        <option value="ARCHIVE">ARCHIVE_KV</option>
      </select>
      <input id="prefix" placeholder="prefix (optional)" style="flex:1" />
      <button id="btnList">List</button>
    </div>
    <ul id="keys"></ul>
  </aside>
  <section class="wrap">
    <div class="bar">
      <input id="key" placeholder="key" style="flex:1"/>
      <button id="btnLoad">Load</button>
      <button id="btnNew">New</button>
      <button id="btnSave">💾 Save</button>
    </div>
    <textarea id="val" placeholder="value (JSON/string)"></textarea>
    <div id="status" class="muted" style="margin-top:8px"></div>
  </section>
</main>

<script>
const secret = ${JSON.stringify(secret)};
const $ = (id)=>document.getElementById(id);
const status = (msg, cls="muted")=>{
  const el=$("status"); el.className=cls; el.textContent=msg;
};
async function api(path, params={}, body=null, method) {
  const u = new URL(path, location.origin);
  u.searchParams.set("s", secret);
  for (const [k,v] of Object.entries(params||{})) u.searchParams.set(k, v);
  const opt = { method: method || (body? "POST":"GET") };
  if (body){ opt.headers = {"content-type":"application/json"}; opt.body = JSON.stringify(body); }
  const r = await fetch(u); return await r.json();
}

async function listKeys() {
  const ns = $("ns").value, prefix=$("prefix").value.trim();
  status("Loading list…");
  const d = await api("/admin/editor/api/list", { ns, prefix });
  const ul = $("keys"); ul.innerHTML="";
  for (const k of d.items||[]) {
    const li = document.createElement("li");
    li.textContent = k; li.onclick=()=>{ $("key").value=k; loadKey(); };
    ul.appendChild(li);
  }
  status("Loaded " + (d.items||[]).length + " keys.", "ok");
}

async function loadKey() {
  const ns = $("ns").value, key=$("key").value.trim();
  if(!key) return;
  status("Loading…");
  const d = await api("/admin/editor/api/get", { ns, key });
  $("val").value = d.value ?? "";
  status("Loaded.", "ok");
}

async function saveKey() {
  const ns = $("ns").value, key=$("key").value.trim(), value=$("val").value;
  if(!key){ status("Key is required","err"); return; }
  status("Saving…");
  const d = await api("/admin/editor/api/put", {}, { ns, key, value }, "POST");
  if (d.ok) status("Saved.","ok"); else status("Save error","err");
}
$("btnList").onclick=listKeys;
$("btnLoad").onclick=loadKey;
$("btnSave").onclick=saveKey;
$("btnNew").onclick=()=>{ $("key").value=""; $("val").value=""; }
</script>`);
  }

  // ---- API ---------------------------------------------------------------
  if (p === "/admin/editor/api/list") {
    if (!isAllowed(env, url)) return json({ ok: false, error: "unauthorized" }, 401);
    const kv = pickKV(env, url.searchParams.get("ns"));
    const prefix = url.searchParams.get("prefix") || "";
    const out = [];
    let cursor;
    do {
      const { keys, cursor: c } = await kv.list({ prefix, cursor });
      for (const k of (keys || [])) out.push(k.name);
      cursor = c;
    } while (cursor);
    return json({ ok: true, items: out });
  }

  if (p === "/admin/editor/api/get") {
    if (!isAllowed(env, url)) return json({ ok: false, error: "unauthorized" }, 401);
    const kv = pickKV(env, url.searchParams.get("ns"));
    const key = url.searchParams.get("key") || "";
    const value = key ? await kv.get(key) : null;
    return json({ ok: true, path: key, value });
  }

  if (p === "/admin/editor/api/put" && req.method === "POST") {
    if (!isAllowed(env, url)) return json({ ok: false, error: "unauthorized" }, 401);
    const body = await req.json().catch(()=>null);
    const kv = pickKV(env, body?.ns);
    const key = String(body?.key||"").trim();
    const value = String(body?.value ?? "");
    if (!key) return json({ ok:false, error:"key required" }, 400);
    await kv.put(key, value);
    return json({ ok: true });
  }

  return json({ ok:false, error:"not found" }, 404);
}