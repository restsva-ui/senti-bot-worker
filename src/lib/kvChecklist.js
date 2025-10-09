// src/lib/kvChecklist.js
// KV-чеклист + (сумісний) HTML UI і робота з архівами

const CHECKLIST_KEY = "senti_checklist.md";
const ARCHIVE_PREFIX = "senti_archive/";

function ensureKv(env) {
  const kv = env.TODO_KV; // використовуємо TODO_KV згідно з твоїм wrangler.toml
  if (!kv) throw new Error("TODO_KV binding missing (wrangler.toml)!");
  return kv;
}

function stamp() {
  const dt = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const nice = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  return { nice, iso: dt.toISOString() };
}

// ===== БАЗОВІ ОПЕРАЦІЇ ЧЕКЛІСТА =====
export async function readChecklist(env) {
  const kv = ensureKv(env);
  const val = await kv.get(CHECKLIST_KEY);
  return val || "# Senti checklist\n";
}

export async function writeChecklist(env, text) {
  const kv = ensureKv(env);
  await kv.put(CHECKLIST_KEY, String(text ?? ""));
  return true;
}

export async function appendChecklist(env, line) {
  const cur = await readChecklist(env);
  const { nice } = stamp();
  const add = `- ${nice} — ${String(line ?? "").trim()}\n`;
  await writeChecklist(env, cur + add);
  return add;
}

// ===== АРХІВИ У KV =====
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

// ===== HTML UI (СУМІСНИЙ ІНТЕРФЕЙС) =====
// ВАЖЛИВО: ця версія приймає ТІЛЬКИ об'єкт опцій,
// як і раніше викликається в src/index.js.
export function checklistHtml({ title = "Senti Checklist", text = "", submitPath = "/admin/checklist/html" } = {}) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c)=>({ "&":"&amp;","<":"&lt;","&gt;":"&gt;" }[c] || c));
  const secret = "senti1984"; // 🔒 додаємо до всіх POST-запитів
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
</style>
<div class="box">
  <h2>📋 ${title}</h2>
  <form method="POST" action="${submitPath}?s=${secret}">
    <div class="row">
      <input type="text" name="line" placeholder="Додати рядок у чеклист...">
      <button type="submit">Append</button>
    </div>
  </form>

  <h3>Вміст</h3>
  <form method="POST" action="${submitPath}?s=${secret}&mode=replace">
    <textarea name="full">${esc(text)}</textarea>
    <div class="row"><button type="submit">💾 Зберегти цілком</button></div>
  </form>
</div>`, { headers: { "content-type": "text/html; charset=utf-8" }});
}