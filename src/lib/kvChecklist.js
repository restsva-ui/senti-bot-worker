// src/lib/kvChecklist.js

const CHECKLIST_KEY = "checklist:text";
const STATUT_KEY = "statut:text";
const REPO_PREFIX = "repo:";

// ===== Безпечні KV операції =====
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

async function kvListSafe(kv, prefix) {
  try {
    const out = await kv.list({ prefix });
    return Array.isArray(out?.keys) ? out.keys : [];
  } catch {
    return [];
  }
}

// ===== Основні функції =====
export async function readChecklist(env) {
  return await kvGetSafe(env?.CHECKLIST_KV, CHECKLIST_KEY, "");
}

export async function writeChecklist(env, text) {
  return await kvPutSafe(env?.CHECKLIST_KV, CHECKLIST_KEY, String(text || ""));
}

export async function appendChecklist(env, line) {
  const kv = env?.CHECKLIST_KV;
  if (!kv) return false;
  const now = new Date().toISOString();
  const row = String(line || "").trim();
  const prefix = row.startsWith("[") ? "" : `[${now}] `;
  const cur = await kvGetSafe(kv, CHECKLIST_KEY, "");
  const next = (cur ? cur + "\n" : "") + prefix + row;
  return await kvPutSafe(kv, CHECKLIST_KEY, next);
}

export async function readStatut(env) {
  return await kvGetSafe(env?.CHECKLIST_KV, STATUT_KEY, "");
}

export async function writeStatut(env, text) {
  return await kvPutSafe(env?.CHECKLIST_KV, STATUT_KEY, String(text || ""));
}

// ===== Робота з архівами =====
export async function listArchives(env) {
  const keys = await kvListSafe(env?.CHECKLIST_KV, REPO_PREFIX);
  return keys.map(k => k.name.replace(REPO_PREFIX, ""));
}

export async function getArchive(env, name) {
  return await kvGetSafe(env?.CHECKLIST_KV, REPO_PREFIX + name, null);
}

export async function saveArchive(env, name, content) {
  return await kvPutSafe(env?.CHECKLIST_KV, REPO_PREFIX + name, content);
}

// ====== HTML для Checklist ======
export async function checklistHtml(env) {
  const raw = await readChecklist(env);
  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const items = lines.map(parseLine).reverse();

  const html = `
<!doctype html><meta charset="utf-8" />
<title>Checklist</title>
<style>
body{background:#0b0f14;color:#e6edf3;font-family:system-ui;padding:20px}
.card{background:#121923;padding:10px 15px;border-radius:10px;margin-bottom:8px}
.ts{color:#a9b4c0;font-family:monospace}
.ok{color:#2ecc71}.err{color:#e74c3c}.info{color:#3498db}
</style>
<h2>📝 Checklist</h2>
${items.map(i=>`<div class="card"><div class="ts">${i.ts}</div><div>${escapeHtml(i.msg)}</div></div>`).join("")}
`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ====== HTML для Statut ======
export async function statutHtml(env) {
  const text = await readStatut(env);
  const html = `
<!doctype html><meta charset="utf-8" />
<title>Statut</title>
<style>
body{background:#0b0f14;color:#e6edf3;font-family:system-ui;padding:20px}
textarea{width:100%;min-height:60vh;background:#121923;color:#e6edf3;
border:1px solid #2b3a49;border-radius:10px;padding:10px;font-family:monospace}
button{margin-top:10px;padding:8px 12px;background:#1f2a36;border:1px solid #2b3a49;
color:#e6edf3;border-radius:8px}
</style>
<h2>📜 Статут</h2>
<form method="post" action="/admin/statut/save">
<textarea name="text">${escapeHtml(text)}</textarea><br/>
<button type="submit">💾 Зберегти</button>
</form>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// ====== Утиліти ======
function escapeHtml(s = "") {
  return s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function parseLine(line = "") {
  const m = line.match(/^\[([^\]]+)\]\s*(.*)$/);
  const ts = m ? m[1] : "";
  const msg = m ? m[2] : line;
  return { ts, msg };
}