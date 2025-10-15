// src/ui/editor.js
// Простий редактор коду в KV з мобільним UI: List / Open last / Save.
// Працює з ендпоінтами: /admin/api/list, /admin/api/get, /admin/api/put

export function kvEditor(secret) {
  const s = String(secret || "").trim();
  const esc = (x) =>
    String(x || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Senti • KV Editor</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --ink:#e7ecf3; --muted:#a7b0be; --acc:#3ea6ff; --ok:#21c07a; --warn:#ffb020; }
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial}
  header{position:sticky;top:0;background:linear-gradient(180deg,var(--panel),rgba(23,26,33,.92));backdrop-filter:saturate(160%) blur(8px);padding:.75rem 1rem;border-bottom:1px solid #22283a}
  h1{margin:0;font-size:1.05rem;letter-spacing:.2px}
  .bar{display:grid;grid-template-columns:1fr auto;gap:.5rem;margin-top:.5rem}
  .row{display:flex;gap:.5rem;align-items:center}
  input,textarea{width:100%;background:#0b0e14;border:1px solid #263043;color:var(--ink);border-radius:.75rem;padding:.7rem .85rem}
  textarea{min-height:48vh;resize:vertical;border-radius:1rem}
  button{appearance:none;border:1px solid #2a3750;background:#122134;color:var(--ink);padding:.6rem .9rem;border-radius:.75rem}
  button.primary{background:#163452;border-color:#1f476c}
  button:active{transform:translateY(1px)}
  .pill{display:inline-flex;gap:.4rem;align-items:center;background:#101722;border:1px solid #223049;color:var(--muted);padding:.35rem .6rem;border-radius:999px;font-size:.8rem}
  .grid{display:grid;gap:.75rem;padding:1rem}
  .list{background:#0b0f17;border:1px solid #223049;border-radius:.75rem;padding:.5rem;max-height:30vh;overflow:auto}
  .item{padding:.4rem .5rem;border-radius:.5rem;cursor:pointer}
  .item:hover{background:#121826}
  .muted{color:var(--muted)}
  .ok{color:var(--ok)}
  .warn{color:var(--warn)}
  .footer{padding:1rem;color:#7f8aa3;font-size:.85rem;text-align:center}
  @media (max-width:600px){ header{padding:.6rem .75rem} .grid{padding:.75rem} textarea{min-height:56vh} }
</style>
</head>
<body>
  <header>
    <h1>KV Editor <span class="pill"><span>secret</span><code id="sec-pill">${esc(s||"(query ?s=...)")}</code></span></h1>
    <div class="bar">
      <div class="row">
        <input id="path" placeholder="path (напр. src/routes/webhook.js)" autocomplete="off" />
      </div>
      <div class="row">
        <button id="btn-list">List</button>
        <button id="btn-last">Open last</button>
        <button id="btn-save" class="primary">Save</button>
      </div>
    </div>
  </header>

  <main class="grid">
    <div class="list" id="list"></div>
    <textarea id="editor" placeholder="// тут буде вміст файлу"></textarea>
    <div class="row">
      <input id="filter" placeholder="фільтр списку (regex/substring)" />
      <button id="btn-apply">Apply</button>
      <span id="status" class="muted">Ready.</span>
    </div>
  </main>

  <div class="footer">Senti • KV code repo • Mobile-first</div>

<script>
(function(){
  const qs = new URL(location).searchParams;
  const secret = ${JSON.stringify(s)} || qs.get("s") || "";
  const $ = (id) => document.getElementById(id);
  const elPath = $("path"), elEditor = $("editor"), elList = $("list"), elFilter = $("filter"), elStatus = $("status");

  // Persist last state
  const LS_PATH = "kv:path"; const LS_BODY = "kv:body"; const LS_LAST = "kv:last";
  try { elPath.value = localStorage.getItem(LS_PATH) || ""; elEditor.value = localStorage.getItem(LS_BODY) || ""; } catch {}

  function setStatus(msg, cls){ elStatus.textContent = msg; elStatus.className = cls || "muted"; }

  async function apiList(){
    const url = "/admin/api/list?s="+encodeURIComponent(secret);
    const r = await fetch(url);
    if(!r.ok){ setStatus("List failed", "warn"); return; }
    const d = await r.json();
    const items = (d.items || []).sort((a,b)=> (b.ts||0)-(a.ts||0));
    renderList(items);
    setStatus("Loaded "+items.length+" item(s).", "muted");
    return items;
  }

  async function apiGet(path){
    const url = "/admin/api/get?path="+encodeURIComponent(path)+"&s="+encodeURIComponent(secret);
    const r = await fetch(url);
    if(!r.ok){ setStatus("Get failed", "warn"); return; }
    const d = await r.json();
    elPath.value = d.path || path;
    elEditor.value = d.value || "";
    try { localStorage.setItem(LS_PATH, elPath.value); localStorage.setItem(LS_BODY, elEditor.value); localStorage.setItem(LS_LAST, elPath.value); } catch {}
    setStatus("Opened: "+(d.path||path), "muted");
  }

  async function apiPut(path, body){
    const url = "/admin/api/put?path="+encodeURIComponent(path)+"&s="+encodeURIComponent(secret);
    const r = await fetch(url, { method:"POST", body });
    if(!r.ok){ setStatus("Save failed", "warn"); return; }
    const d = await r.json();
    setStatus("Saved "+d.bytes+" bytes → "+d.path, "ok");
    try { localStorage.setItem(LS_PATH, path); localStorage.setItem(LS_BODY, body); localStorage.setItem(LS_LAST, path); } catch {}
  }

  function renderList(items){
    const f = (elFilter.value || "").trim();
    let arr = items;
    if(f){
      try {
        const rx = new RegExp(f, "i");
        arr = items.filter(x => rx.test(x.key));
      } catch {
        arr = items.filter(x => (x.key||"").toLowerCase().includes(f.toLowerCase()));
      }
    }
    elList.innerHTML = arr.map(x => {
      const when = x.ts ? new Date(x.ts).toLocaleString() : "";
      return '<div class="item" data-k="'+x.key+'"><strong>'+x.key+'</strong><br><span class="muted">'+when+'</span></div>';
    }).join("") || '<div class="muted">Порожньо…</div>';
    Array.from(elList.querySelectorAll(".item")).forEach(it=>{
      it.addEventListener("click", () => apiGet(it.dataset.k));
      it.addEventListener("touchend", () => apiGet(it.dataset.k));
    });
  }

  // Buttons
  $("btn-list").onclick = apiList;
  $("btn-apply").onclick = apiList;
  $("btn-last").onclick = () => {
    const last = localStorage.getItem(LS_LAST);
    if(last) apiGet(last); else setStatus("Last is empty", "warn");
  };
  $("btn-save").onclick = () => {
    const path = elPath.value.trim();
    const body = elEditor.value;
    if(!path) { setStatus("Вкажи path", "warn"); return; }
    apiPut(path, body);
  };

  // Load initial
  apiList().catch(()=>{});
})();
</script>
</body></html>`;
}