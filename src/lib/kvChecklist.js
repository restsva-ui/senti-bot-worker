// KV-чеклист + Архіви + Статут + HTML UI

const CHECKLIST_KEY = "senti_checklist.md";
const ARCHIVE_PREFIX = "senti_archive/";
const STATUT_KEY = "senti_statut.md";

function ensureKv(env) {
  const kv = env.TODO_KV;
  if (!kv) throw new Error("TODO_KV binding missing (wrangler.toml)!");
  return kv;
}

function stamp() {
  const dt = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    iso: dt.toISOString(),
    nice: `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
  };
}

// ---- helpers for absolute URLs ----
function baseUrl(env) {
  const host = env?.SERVICE_HOST;
  if (!host) throw new Error("SERVICE_HOST is not set");
  return `https://${host}`;
}
export function archiveLink(env, key) {
  const s = env.WEBHOOK_SECRET ? `&s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
  return `${baseUrl(env)}/admin/archive/get?key=${encodeURIComponent(key)}${s}`;
}

// ===== ЧЕКЛІСТ =====
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
  const cur = await readChecklist(env);
  const { nice } = stamp();
  const add = `- ${nice} — ${String(line ?? "").trim()}\n`;
  await writeChecklist(env, cur + add);
  return add;
}

// ===== АРХІВИ =====
export async function saveArchive(env, file) {
  const kv = ensureKv(env);
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Invalid file upload");
  const buf = await file.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const name = (file.name || "file.bin").replace(/[^\w.\-]+/g, "_");
  const key = `${ARCHIVE_PREFIX}${new Date().toISOString()}__${name}`;
  await kv.put(key, b64);

  // повертаємо одразу все корисне + абсолютну URL для відкриття
  return {
    key,
    name,
    bytes: buf.byteLength,
    url: archiveLink(env, key),
  };
}
export async function listArchives(env) {
  const kv = ensureKv(env);
  const { keys } = await kv.list({ prefix: ARCHIVE_PREFIX });
  // найновіші зверху
  return keys.map(k => k.name).sort().reverse();
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

// ===== СТАТУТ =====
export async function readStatut(env) {
  const kv = ensureKv(env);
  return (await kv.get(STATUT_KEY)) || "# STATUT\n\n(Опиши тут обов’язкові правила для GPT)\n";
}
export async function writeStatut(env, text) {
  const kv = ensureKv(env);
  await kv.put(STATUT_KEY, String(text ?? ""));
  return true;
}

// ===== HTML =====
function esc(s){ return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

export function checklistHtml({ title="Senti Checklist", text="", submitPath="/admin/checklist/html", secret="" } = {}) {
  const q = secret ? `?s=${encodeURIComponent(secret)}` : "";
  return new Response(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:20px;line-height:1.45}
  .box{max-width:980px;margin:0 auto}
  .row{display:flex;gap:10px;margin:10px 0;flex-wrap:wrap}
  input[type=text]{flex:1;min-width:240px;padding:10px;border:1px solid #ccc;border-radius:10px}
  textarea{width:100%;height:60vh;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
  button{padding:9px 14px;border:1px solid #ccc;border-radius:10px;background:#fafafa;cursor:pointer}
  .top{display:flex;align-items:center;gap:10px}
  .pill{padding:6px 10px;border:1px solid #ddd;border-radius:999px;background:#fff;text-decoration:none;color:inherit}
  .right{margin-left:auto}
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

  <form method="POST" action="/admin/checklist/upload${q}" enctype="multipart/form-data">
    <div class="row">
      <input type="file" name="file">
      <button type="submit">Додати файл</button>
    </div>
  </form>

  <h3>Вміст</h3>
  <form method="POST" action="${submitPath+q}&mode=replace">
    <textarea name="full">${esc(text)}</textarea>
    <div class="row"><button type="submit">💾 Зберегти цілком</button></div>
  </form>
</div>`, { headers:{ "content-type":"text/html; charset=utf-8" }});
}

export function statutHtml({ title="STATUT", text="", submitPath="/admin/statut/html", secret="" } = {}) {
  const q = secret ? `?s=${encodeURIComponent(secret)}` : "";
  return new Response(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:20px}
  .box{max-width:980px;margin:0 auto}
  textarea{width:100%;height:70vh;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace}
  button{padding:9px 14px;border:1px solid #ccc;border-radius:10px;background:#fafafa;cursor:pointer}
  .pill{padding:6px 10px;border:1px solid #ddd;border-radius:999px;background:#fff;text-decoration:none;color:inherit}
</style>
<div class="box">
  <h2>📌 ${title}</h2>
  <div style="margin:10px 0"><a class="pill" href="/admin/checklist/html${q}">⬅ Назад до Checklist</a></div>
  <form method="POST" action="${submitPath+q}">
    <textarea name="full">${esc(text)}</textarea>
    <div style="margin-top:10px"><button type="submit">💾 Зберегти STATUT</button></div>
  </form>
</div>`, { headers:{ "content-type":"text/html; charset=utf-8" }});
}