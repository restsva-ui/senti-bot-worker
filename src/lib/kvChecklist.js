// src/lib/kvChecklist.js

// Ключі у KV
const CHECKLIST_KEY = "checklist:text";
const STATUT_KEY = "statut:text";

// ---------- Безпечні обгортки над KV ----------
async function kvGetSafe(kv, key, fallback = "") {
  try {
    const v = await kv.get(key);
    return typeof v === "string" ? v : fallback;
  } catch {
    return fallback;
  }
}

async function kvPutSafe(kv, key, value) {
  try {
    await kv.put(key, value);
    return true;
  } catch {
    return false;
  }
}

// ---------- Публічне: додати рядок у чекліст ----------
export async function appendChecklist(env, line) {
  const kv = env?.CHECKLIST_KV;
  if (!kv) return false;

  const now = new Date().toISOString();
  const row = String(line || "").trim();
  const prefix = row.startsWith("[") ? "" : `[${now}] `;

  const cur = await kvGetSafe(kv, CHECKLIST_KEY, "");
  const next = (cur ? `${cur}\n` : "") + prefix + row;
  return await kvPutSafe(kv, CHECKLIST_KEY, next);
}

// ---------- Публічне: HTML чекліста (View + Raw) ----------
export async function checklistHtml(env) {
  const kv = env?.CHECKLIST_KV;
  const raw = kv ? await kvGetSafe(kv, CHECKLIST_KEY, "") : "";

  // Підготовка структурованих елементів для «красивого» режиму
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const items = lines.map(parseLine).reverse(); // нові зверху

  const html = `
<!doctype html>
<meta charset="utf-8" />
<title>Checklist</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    --bg:#0b0f14; --panel:#121923; --muted:#a9b4c0; --text:#e6edf3;
    --ok:#2ecc71; --warn:#f1c40f; --err:#e74c3c; --info:#3498db; --note:#9b59b6; --miss:#ff7f50;
    --chip:#1f2a36; --chip-br:#2b3a49;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial}
  .wrap{max-width:980px;margin:24px auto;padding:0 16px}
  h1{font-size:20px;margin:0 0 12px}
  .tabs{display:flex;gap:8px;margin:12px 0 16px}
  .tab{padding:8px 12px;background:var(--panel);border:1px solid var(--chip-br);border-radius:8px;cursor:pointer}
  .tab.active{outline:2px solid var(--info)}
  .toolbar{display:flex;gap:8px;margin:8px 0 16px;flex-wrap:wrap}
  button,a.btn{padding:8px 12px;border-radius:8px;border:1px solid var(--chip-br);background:var(--chip);color:var(--text);text-decoration:none;cursor:pointer}
  .list{display:grid;gap:8px}
  .item{background:var(--panel);border:1px solid var(--chip-br);border-radius:12px;padding:10px 12px}
  .row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .ts{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
  .msg{white-space:pre-wrap;word-break:break-word}
  .chips{display:flex;gap:6px}
  .chip{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--chip-br);background:var(--chip)}
  .chip.ok{border-color:#21462e;background:#11261a;color:var(--ok)}
  .chip.warn{border-color:#4d3f12;background:#1f1808;color:var(--warn)}
  .chip.err{border-color:#5c2320;background:#2a0d0b;color:var(--err)}
  .chip.info{border-color:#1d3f56;background:#0c1a23;color:var(--info)}
  .chip.note{border-color:#3e2b52;background:#1a1023;color:var(--note)}
  .chip.miss{border-color:#5a2b1a;background:#231109;color:var(--miss)}
  .day{margin:18px 0 8px;color:var(--muted);font-weight:600}
  textarea{width:100%;min-height:55vh;background:var(--panel);color:var(--text);border:1px solid var(--chip-br);border-radius:10px;padding:12px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .hidden{display:none}
  .search{display:flex;gap:8px;flex-wrap:wrap}
  .search input{padding:8px 10px;border-radius:8px;border:1px solid var(--chip-br);background:#0f1620;color:var(--text);min-width:220px}
  .summary{color:var(--muted);margin:-6px 0 8px}
</style>
<div class="wrap">
  <h1>📝 Checklist</h1>

  <div class="tabs">
    <div class="tab active" data-tab="view">View</div>
    <div class="tab" data-tab="raw">Raw</div>
  </div>

  <div id="viewTab">
    <div class="toolbar">
      <button id="btnRefresh">Оновити</button>
      <button id="btnCopy">Скопіювати JSON</button>
      <a class="btn" id="btnDownload" download="checklist.txt">Завантажити .txt</a>
    </div>

    <div class="search">
      <input id="q" placeholder="Фільтр (error, miss, heartbeat, evolve, auto-improve, deploy…)" />
      <button id="btnClear">Очистити фільтр</button>
    </div>
    <div class="summary" id="summary"></div>
    <div id="timeline"></div>
  </div>

  <div id="rawTab" class="hidden">
    <p style="color:var(--muted);margin:6px 0 8px">Сирий текст (read-only у цьому вигляді).</p>
    <textarea readonly>${escapeHtml(raw)}</textarea>
  </div>
</div>

<script>
const allItems = ${JSON.stringify(items)};
const rawText = ${JSON.stringify(raw)};

function g(id){ return document.getElementById(id); }
function el(tag, cls, text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }

function groupByDay(items){
  const m = new Map();
  for(const it of items){
    const day = it.dateOnly || "Unknown";
    if(!m.has(day)) m.set(day, []);
    m.get(day).push(it);
  }
  return m;
}

function render(list){
  const host = g("timeline");
  host.innerHTML = "";
  const listWrap = el("div","list");
  const grouped = groupByDay(list);
  for (const [day, arr] of grouped){
    listWrap.appendChild(el("div","day", day));
    for(const it of arr){
      const card = el("div","item");
      const row1 = el("div","row");
      row1.appendChild(el("div","ts", it.timeOnly || it.ts));
      const chips = el("div","chips");
      for(const c of it.chips) chips.appendChild(el("span","chip "+c.kind, c.text));
      row1.appendChild(chips);
      card.appendChild(row1);
      card.appendChild(el("div","msg", it.msg));
      listWrap.appendChild(card);
    }
  }
  host.appendChild(listWrap);
  g("summary").textContent = "Записів: " + list.length + (list.length !== allItems.length ? " (відфільтровано)" : "");
}

function setActive(tab){
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===tab));
  g("viewTab").classList.toggle("hidden", tab!=="view");
  g("rawTab").classList.toggle("hidden", tab!=="raw");
}

document.querySelectorAll(".tab").forEach(t=>{
  t.addEventListener("click",()=>setActive(t.dataset.tab));
});

g("btnRefresh").onclick = ()=> location.reload();
g("btnCopy").onclick = ()=>{
  navigator.clipboard.writeText(JSON.stringify(allItems,null,2));
  alert("Скопійовано JSON у буфер");
};
const blob = new Blob([rawText], {type:"text/plain"});
g("btnDownload").href = URL.createObjectURL(blob);

// Простий фільтр
const input = g("q");
function applyFilter(){
  const q = (input.value || "").trim().toLowerCase();
  if (!q) return render(allItems);
  const list = allItems.filter(it => {
    const hay = [it.msg.toLowerCase(), ...it.chips.map(c=>c.text.toLowerCase())].join(" ");
    return hay.includes(q);
  });
  render(list);
}
input.addEventListener("input", applyFilter);
g("btnClear").onclick = ()=>{ input.value=""; applyFilter(); };

render(allItems);
</script>
`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

// ---------- Публічне: HTML статуту (простий редактор) ----------
export async function statutHtml(env) {
  const kv = env?.CHECKLIST_KV;
  const current = kv
    ? await kvGetSafe(kv, STATUT_KEY, "Статут ще не задано.")
    : "KV binding CHECKLIST_KV is missing.";

  const page = `
<!doctype html>
<meta charset="utf-8" />
<title>Statut</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{margin:0;background:#0b0f14;color:#e6edf3;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial}
  .wrap{max-width:980px;margin:24px auto;padding:0 16px}
  textarea{width:100%;min-height:70vh;background:#121923;color:#e6edf3;border:1px solid #2b3a49;border-radius:10px;padding:12px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  button{margin-top:10px;padding:8px 12px;border-radius:8px;border:1px solid #2b3a49;background:#1f2a36;color:#e6edf3;cursor:pointer}
</style>
<div class="wrap">
  <h1>📜 Статут</h1>
  <form method="post" action="/admin/statut/save">
    <textarea name="text" spellcheck="false">${escapeHtml(current)}</textarea>
    <br/>
    <button type="submit">Зберегти</button>
  </form>
</div>`;
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ---------- Утиліти: парсинг/теги ----------
function escapeHtml(s = "") {
  return s.replace(/[&<>"]/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[ch]));
}

function parseLine(line) {
  // Очікуємо: [ISO] message...
  let ts = "";
  let msg = line;
  const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (m) { ts = m[1]; msg = m[2] || ""; }

  const d = ts ? new Date(ts) : null;
  const dateOnly = d ? d.toISOString().slice(0,10) : "";
  const timeOnly = d ? d.toISOString().slice(11,19) + "Z" : "";

  const chips = detectTags(msg);
  return { ts, dateOnly, timeOnly, msg, chips };
}

function detectTags(msg = "") {
  const s = msg.toLowerCase();
  const chips = [];

  // Типові події
  if (s.includes("heartbeat")) chips.push({ kind:"ok", text:"heartbeat" });
  if (s.includes("refreshcheck")) chips.push({ kind:"info", text:"refresh" });
  if (s.includes("deploy")) chips.push({ kind:"note", text:"deploy" });
  if (s.includes("source=manual")) chips.push({ kind:"note", text:"manual" });
  if (s.includes("cron @")) chips.push({ kind:"info", text:"cron" });
  if (s.includes("miss")) chips.push({ kind:"miss", text:"miss" });

  // Нічні агенти / еволюція / тренування
  if (s.includes("auto_improve")) chips.push({ kind:"info", text:"auto-improve" });
  if (s.includes("evolve")) chips.push({ kind:"info", text:"evolve" });
  if (s.includes("train")) chips.push({ kind:"info", text:"train" });

  // Стани
  if (s.includes("error") || s.includes("fail")) chips.push({ kind:"err", text:"error" });
  if (s.includes("warn")) chips.push({ kind:"warn", text:"warn" });
  if (/\bok\b$|\bok\b/.test(s)) chips.push({ kind:"ok", text:"ok" });

  // За замовчуванням
  if (!chips.length) chips.push({ kind:"note", text:"note" });

  return chips;
}