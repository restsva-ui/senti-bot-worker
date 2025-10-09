// KV-чеклист + HTML UI + архіви + auto "новий день"

const CHECKLIST_KEY = "senti_checklist.md";
const ARCHIVE_PREFIX = "senti_archive/";

function ensureKv(env) {
  const kv = env.TODO_KV;
  if (!kv) throw new Error("TODO_KV binding missing (wrangler.toml)!");
  return kv;
}

function pad(n){ return String(n).padStart(2,"0"); }
function nowParts(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth()+1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const MM = pad(d.getMinutes());
  return { date:`${yyyy}-${mm}-${dd}`, time:`${HH}:${MM}`, iso:d.toISOString() };
}

// ---------- базові оп
export async function readChecklist(env) {
  const val = await ensureKv(env).get(CHECKLIST_KEY);
  return val || "# Senti checklist\n";
}
export async function writeChecklist(env, text) {
  await ensureKv(env).put(CHECKLIST_KEY, String(text ?? ""));
  return true;
}

// вставляє заголовок "## YYYY-MM-DD", якщо його ще нема зверху
async function ensureTodayHeader(env, textMaybe){
  const text = textMaybe ?? await readChecklist(env);
  const { date } = nowParts();
  const header = `## ${date}`;
  if (text.includes(`\n${header}\n`) || text.trimEnd().endsWith(header)) return text; // вже є
  // якщо кінець файлу не закінчується \n — додамо
  const base = text.endsWith("\n") ? text : text + "\n";
  return base + `${header}\n`;
}

export async function newDay(env){
  const cur = await readChecklist(env);
  const withHeader = await ensureTodayHeader(env, cur);
  if (withHeader !== cur) await writeChecklist(env, withHeader);
  return withHeader;
}

export async function appendChecklist(env, line) {
  const cur = await readChecklist(env);
  const prepared = await ensureTodayHeader(env, cur);
  const { time } = nowParts();
  const add = `- ${time} — ${String(line ?? "").trim()}\n`;
  await writeChecklist(env, prepared + add);
  return add;
}

// ---------- архіви (як було)
export async function saveArchive(env, file) {
  const kv = ensureKv(env);
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Invalid file upload");
  const buf = await file.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const name = (file.name || "file.bin").replace(/[^\w.\-]+/g, "_");
  const key = `${ARCHIVE_PREFIX}${new Date().toISOString()}__${name}`;
  await kv.put(key, b64);
  return key;
}
export async function listArchives(env) {
  const { keys } = await ensureKv(env).list({ prefix: ARCHIVE_PREFIX });
  return keys.map(k => k.name);
}
export async function getArchive(env, key) {
  return await ensureKv(env).get(key);
}
export async function deleteArchive(env, key) {
  await ensureKv(env).delete(key);
  return true;
}

// ---------- HTML UI
export function checklistHtml({ title = "Senti Checklist", text = "", submitPath = "/admin/checklist/html" } = {}) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c] || c));
  const secret = "senti1984"; // підставляється у форми
  return new Response(`<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:20px;line-height:1.45}
  textarea{width:100%;height:60vh;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
  .box{max-width:980px;margin:0 auto}
  .row{display:flex;gap:10px;margin:10px 0;flex-wrap:wrap}
  button{padding:8px 14px;border-radius:8px;border:1px solid #ccc;background:#fafafa;cursor:pointer}
  input[type=text]{flex:1;min-width:240px;padding:8px 10px;border-radius:8px;border:1px solid #ccc}
  .btn{display:inline-flex;align-items:center;gap:8px}
</style>
<div class="box">
  <h2>📋 ${title}</h2>

  <form method="POST" action="${submitPath}?s=${secret}">
    <div class="row">
      <input type="text" name="line" placeholder="Додати рядок у чеклист...">
      <button class="btn" type="submit">Append</button>
    </div>
  </form>

  <form method="POST" action="${submitPath}?s=${secret}&mode=newday">
    <button class="btn" type="submit">🗓 Новий день</button>
  </form>

  <h3>Вміст</h3>
  <form method="POST" action="${submitPath}?s=${secret}&mode=replace">
    <textarea name="full">${esc(text)}</textarea>
    <div class="row"><button class="btn" type="submit">💾 Зберегти цілком</button></div>
  </form>
</div>`, { headers: { "content-type": "text/html; charset=utf-8" }});
}