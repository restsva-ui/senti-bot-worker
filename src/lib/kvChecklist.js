// ===== HTML =====
function esc(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

export function checklistHtml({ title="Senti Checklist", text="", submitPath="/admin/checklist/html", secret="" } = {}) {
  const q = secret ? `?s=${encodeURIComponent(secret)}` : "";
  const err = (typeof location === "undefined") ? "" : ""; // SSR-safe
  return new Response(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:20px;line-height:1.45}
  .box{max-width:980px;margin:0 auto}
  .row{display:flex;gap:10px;margin:10px 0;flex-wrap:wrap}
  input[type=text]{flex:1;min-width:240px;padding:10px;border:1px solid #ccc;border-radius:10px}
  input[type=file]{flex:1;min-width:240px}
  textarea{width:100%;height:48vh;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
  button{padding:9px 14px;border:1px solid #ccc;border-radius:10px;background:#fafafa;cursor:pointer}
  .top{display:flex;align-items:center;gap:10px}
  .pill{padding:6px 10px;border:1px solid #ddd;border-radius:999px;background:#fff}
  .right{margin-left:auto}
  .preview{border:1px solid #e5e5e5;border-radius:10px;padding:10px;background:#fff;max-height:36vh;overflow:auto;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}
  .line{display:block}
  .ok{color:#0a0;font-weight:500}
  .fail{color:#b00020;font-weight:600}
  .note{color:#555}
  .badge{padding:1px 6px;border-radius:6px;border:1px solid #ddd;background:#f5f5f5;margin-left:6px;font-size:12px}
  .err{color:#b00020}
</style>
<div class="box">
  <div class="top">
    <h2 style="margin:0">📋 ${title}</h2>
    <a class="pill" href="/admin/statut/html${q}">📌 STATUT</a>
    <a class="pill" href="/admin/repo/html${q}">📚 Архів</a>
    <a class="pill right" href="/health">Health</a>
  </div>

  <form method="POST" action="${submitPath+q}">
    <div class="row">
      <input type="text" name="line" placeholder="Додати рядок у чеклист…">
      <button type="submit">Append</button>
    </div>
  </form>

  <form id="upForm" method="POST" action="/admin/checklist/upload${q}" enctype="multipart/form-data" onsubmit="return ensureFile()">
    <div class="row">
      <input type="file" name="file" id="fileInput">
      <button type="submit">Додати файл</button>
      <span id="err" class="err"></span>
    </div>
  </form>

  <h3>Вміст</h3>
  <div class="row" style="flex-direction:column;width:100%">
    <div class="preview" id="preview"></div>
  </div>

  <form method="POST" action="${submitPath+q}&mode=replace">
    <textarea id="full" name="full">${esc(text)}</textarea>
    <div class="row"><button type="submit">💾 Зберегти цілком</button></div>
  </form>
</div>
<script>
function ensureFile(){
  const f = document.getElementById('fileInput');
  const err = document.getElementById('err');
  if(!f || !f.files || f.files.length===0){ err.textContent = 'Спочатку вибери файл'; return false; }
  err.textContent = '';
  return true;
}
function classify(line){
  const L = line.toLowerCase();
  if(L.includes('deploy') && L.includes('status=ok')) return 'ok';
  if(L.includes('deploy') && (L.includes('status=fail')||L.includes('status=error'))) return 'fail';
  if(L.includes('heartbeat')||L.includes('tick')||L.includes('refreshcheck')) return 'note';
  return '';
}
function render(){
  const t = document.getElementById('full').value.split(/\\n/);
  const out = t.map(l=>'<span class="line '+classify(l)+'">'+l.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</span>').join('');
  document.getElementById('preview').innerHTML = out || '<em>Порожньо</em>';
}
render();
document.getElementById('full').addEventListener('input', render);
</script>
`, { headers:{ "content-type":"text/html; charset=utf-8" }});
}