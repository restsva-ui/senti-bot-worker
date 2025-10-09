// src/lib/kvChecklist.js
// Повноцінний KV чекліст із архівами + HTML UI

const CHECKLIST_KEY = "senti_checklist.md";
const ARCHIVE_PREFIX = "senti_archive/";

function ensureKv(env) {
  const kv = env.TODO_KV;
  if (!kv) throw new Error("TODO_KV binding missing!");
  return kv;
}

function stamp() {
  const dt = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const iso = dt.toISOString();
  const nice = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  return { iso, nice };
}

// === базові операції ===
export async function readChecklist(env) {
  const kv = ensureKv(env);
  return (await kv.get(CHECKLIST_KEY)) || "# Senti checklist\n";
}

export async function writeChecklist(env, text) {
  const kv = ensureKv(env);
  await kv.put(CHECKLIST_KEY, String(text ?? ""));
  return true;
}

export async function appendChecklist(env, line) {
  const kv = ensureKv(env);
  const { nice } = stamp();
  const current = await readChecklist(env);
  const add = `- ${nice} — ${String(line ?? "").trim()}\n`;
  await kv.put(CHECKLIST_KEY, current + add);
  return add;
}

// === робота з архівами ===
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
  const kv = ensureKv(env);
  const { keys } = await kv.list({ prefix: ARCHIVE_PREFIX });
  return keys.map(k => k.name);
}

export async function getArchive(env, key) {
  const kv = ensureKv(env);
  return await kv.get(key);
}

export async function deleteArchive(env, key) {
  const kv = ensureKv(env);
  await kv.delete(key);
  return true;
}

// === HTML інтерфейс ===
export async function checklistHtml(env, s) {
  const text = await readChecklist(env);
  const archives = await listArchives(env);
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const qs = `?s=${encodeURIComponent(s || "")}`;

  return new Response(`<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<title>Senti Checklist</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:20px;line-height:1.45}
textarea{width:100%;height:55vh;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
h2{margin-top:0}
button{padding:6px 12px;cursor:pointer;border-radius:6px;border:1px solid #ccc;background:#fafafa}
input[type=text],input[type=file]{padding:6px 8px;border-radius:6px;border:1px solid #ccc;width:100%}
.row{display:flex;gap:10px;margin:10px 0;flex-wrap:wrap}
.list{margin-top:16px}
.list-item{padding:4px 0;border-bottom:1px solid #eee}
a{color:#0065ff;text-decoration:none}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<h2>📋 Senti Checklist</h2>

<form method="POST" action="/admin/checklist/html${qs}">
  <div class="row">
    <input type="text" name="line" placeholder="Додати рядок у чекліст...">
    <button type="submit">Append</button>
  </div>
</form>

<form method="POST" action="/admin/checklist/html${qs}?mode=replace">
  <textarea name="full">${esc(text)}</textarea>
  <div class="row"><button type="submit">💾 Зберегти цілком</button></div>
</form>

<h3>📦 Архіви у KV</h3>
<form method="POST" action="/admin/checklist/upload${qs}" enctype="multipart/form-data">
  <div class="row">
    <input type="file" name="file" required>
    <button type="submit">⬆️ Завантажити</button>
  </div>
</form>

<div class="list">
  ${archives.length
    ? archives.map(k => `<div class="list-item">
        <a href="/admin/checklist/archive${qs}&k=${encodeURIComponent(k)}">${k.replace(ARCHIVE_PREFIX,"")}</a>
        <form style="display:inline" method="POST" action="/admin/checklist/delete${qs}">
          <input type="hidden" name="key" value="${esc(k)}"/>
          <button style="background:#fee;border-color:#f99">🗑 Видалити</button>
        </form>
      </div>`).join("")
    : "<p><i>Архівів поки немає.</i></p>"
  }
</div>

</body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}