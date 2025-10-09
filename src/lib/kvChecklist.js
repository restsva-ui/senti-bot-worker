// src/lib/kvChecklist.js
// Простий чеклист у KV + міні-HTML UI для адміна

const KEY = "senti_checklist.md";

function ensureKv(env) {
  const kv = env.CHECKLIST_KV;
  if (!kv) throw new Error("CHECKLIST_KV binding missing (wrangler.toml)!");
  return kv;
}

function stamp() {
  const dt = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const iso = dt.toISOString();
  return { iso, nice: `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}` };
}

export async function readChecklist(env) {
  const kv = ensureKv(env);
  const val = await kv.get(KEY);
  return val || "# Senti checklist\n";
}

export async function writeChecklist(env, text) {
  const kv = ensureKv(env);
  await kv.put(KEY, text);
  return true;
}

export async function appendChecklist(env, line) {
  const cur = await readChecklist(env);
  const { nice } = stamp();
  const add = `- ${nice} — ${line}\n`;
  await writeChecklist(env, cur + add);
  return add;
}

// ---- HTML admin UI ----
export function checklistHtml({ title = "Senti Checklist", text = "" , submitPath = "/admin/checklist/html" } = {}) {
  const esc = (s) => s.replace(/[&<>]/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
  return new Response(`<!doctype html>
<meta charset="utf-8">
<title>${title}</title>
<style>
  body{font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin:20px; line-height:1.45}
  textarea{width:100%; height:60vh; font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace}
  .box{max-width:980px; margin:0 auto}
  .row{display:flex; gap:10px; margin:10px 0}
  button{padding:8px 14px; border-radius:8px; border:1px solid #ccc; background:#fafafa; cursor:pointer}
  input[type=text]{flex:1; padding:8px 10px; border-radius:8px; border:1px solid #ccc}
</style>
<div class="box">
  <h2>📋 ${title}</h2>
  <form method="POST" action="${submitPath}">
    <div class="row">
      <input type="text" name="line" placeholder="Додати рядок у чеклист...">
      <button type="submit">Append</button>
    </div>
  </form>

  <h3>Вміст</h3>
  <form method="POST" action="${submitPath}?mode=replace">
    <textarea name="full">${esc(text)}</textarea>
    <div class="row"><button type="submit">💾 Зберегти цілком</button></div>
  </form>
</div>`, { headers: { "content-type": "text/html; charset=utf-8" }});
}