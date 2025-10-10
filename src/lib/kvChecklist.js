// src/lib/kvChecklist.js

// ====== KEYS / PREFIXES ======
const CHECKLIST_KEY = "senti_checklist.txt";
const STATUT_KEY = "senti_statut.md";
const ARCHIVE_PREFIX = "senti_archive/";

// ====== helpers ======
function ensureKV(env) {
  if (!env.CHECKLIST_KV) throw new Error("CHECKLIST_KV binding missing");
  return env.CHECKLIST_KV;
}
const textResp = (s) => new Response(String(s || ""), { headers: { "content-type": "text/plain; charset=utf-8" } });

// ====== Checklist (txt) ======
export async function readChecklist(env) {
  const kv = ensureKV(env);
  return (await kv.get(CHECKLIST_KEY)) || "";
}

export async function writeChecklist(env, text) {
  const kv = ensureKV(env);
  await kv.put(CHECKLIST_KEY, String(text ?? ""), { metadata: { updatedAt: Date.now() } });
  return true;
}

export async function appendChecklist(env, line) {
  const kv = ensureKV(env);
  const cur = (await kv.get(CHECKLIST_KEY)) || "";
  const stamp = new Date().toISOString();
  const out = cur + (cur.endsWith("\n") || cur === "" ? "" : "\n") + `[${stamp}] ${line}\n`;
  await kv.put(CHECKLIST_KEY, out, { metadata: { updatedAt: Date.now() } });
  return line;
}

export function checklistHtml({ text = "", submitPath = "/admin/checklist/html", secret = "" }) {
  const q = secret ? `?s=${encodeURIComponent(secret)}` : "";
  const repoLink = `/admin/repo/html${q}`;
  const statutLink = `/admin/statut/html${q}`;
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Checklist</title>
    <style>
      body{font:14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, "Apple Color Emoji","Segoe UI Emoji";}
      textarea{width:100%; height:320px}
      .wrap{max-width:900px; margin:24px auto; padding:0 12px}
      .grid{display:grid; gap:16px}
      .soft{background:#fafafa; padding:12px; border-radius:10px; border:1px solid #eee}
      .row{display:flex; gap:8px; align-items:center}
      .row input[type=file]{max-width:360px}
      code{background:#f3f3f3; padding:2px 6px; border-radius:6px}
      a.btn{display:inline-block; padding:8px 12px; background:#eef6ff; border:1px solid #cfe3ff; border-radius:10px; text-decoration:none}
    </style>
    <div class="wrap">
      <h2>📋 Checklist</h2>
      <p class="row">
        <a class="btn" href="${repoLink}">📚 Відкрити Repo</a>
        <a class="btn" href="${statutLink}">📜 Статут</a>
      </p>

      <div class="grid">
        <form class="soft" method="post" action="${submitPath}${q}">
          <h3>✏️ Replace full text</h3>
          <textarea name="full">${escapeHtml(text)}</textarea>
          <p><button type="submit">Зберегти</button></p>
        </form>

        <form class="soft" method="post" action="${submitPath}${q}">
          <h3>➕ Append рядок</h3>
          <p><input name="line" style="width:100%" placeholder="новий рядок..." /></p>
          <p><button type="submit">Додати</button></p>
        </form>

        <form class="soft" method="post" action="/admin/checklist/upload${q}" enctype="multipart/form-data">
          <h3>⬆️ Завантажити файл у Repo та додати лінк в чеклист</h3>
          <div class="row">
            <input type="file" name="file" required />
            <input type="text" name="who" placeholder="позначка (необов'язково)"/>
            <button type="submit">Завантажити</button>
          </div>
          <p class="hint">Після завантаження зʼявиться запис у чеклисті з прямим посиланням.</p>
        </form>
      </div>
    </div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ====== Repo (binary in KV, base64) ======
async function fileToB64(file) {
  const ab = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(ab);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function saveArchive(env, file) {
  const kv = ensureKV(env);
  const b64 = await fileToB64(file);
  const ts = new Date().toISOString();
  const safe = (file?.name || "file").replace(/[^\w.\-]+/g, "_");
  const key = `${ARCHIVE_PREFIX}${ts}__${safe}`;
  await kv.put(key, b64, { metadata: { name: file?.name || "file", size: file?.size || 0, createdAt: ts } });
  return key;
}

/** Переписує існуючий ключ конкретним файлом */
export async function putArchive(env, key, file) {
  if (!key || !key.startsWith(ARCHIVE_PREFIX)) throw new Error("invalid repo key");
  const kv = ensureKV(env);
  const b64 = await fileToB64(file);
  const ts = new Date().toISOString();
  await kv.put(key, b64, { metadata: { name: file?.name || "file", size: file?.size || 0, updatedAt: ts, overwrite: true } });
  return key;
}

export async function listArchives(env) {
  const kv = ensureKV(env);
  const keys = [];
  let cursor = undefined;
  do {
    const { keys: batch, list_complete, cursor: c } = await kv.list({ prefix: ARCHIVE_PREFIX, cursor });
    batch?.forEach((k) => keys.push(k.name));
    cursor = list_complete ? undefined : c;
  } while (cursor);
  // newest first
  keys.sort().reverse();
  return keys;
}

export async function getArchive(env, key) {
  const kv = ensureKV(env);
  return await kv.get(key);
}

export async function deleteArchive(env, key) {
  const kv = ensureKV(env);
  await kv.delete(key);
  return true;
}

// ====== Statut (md) ======
export async function readStatut(env) {
  const kv = ensureKV(env);
  return (await kv.get(STATUT_KEY)) || "";
}
export async function writeStatut(env, text) {
  const kv = ensureKV(env);
  await kv.put(STATUT_KEY, String(text ?? ""), { metadata: { updatedAt: Date.now() } });
  return true;
}

export function statutHtml({ text = "", submitPath = "/admin/statut/html", secret = "" }) {
  const q = secret ? `?s=${encodeURIComponent(secret)}` : "";
  const back = `/admin/checklist/html${q}`;
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Statut</title>
    <style>
      body{font:14px/1.45 system-ui, -apple-system, Segoe UI, Roboto}
      textarea{width:100%; height:420px}
      .wrap{max-width:900px; margin:24px auto; padding:0 12px}
      a.btn{display:inline-block; padding:8px 12px; background:#eef6ff; border:1px solid #cfe3ff; border-radius:10px; text-decoration:none}
    </style>
    <div class="wrap">
      <p><a class="btn" href="${back}">⬅ До Checklist</a></p>
      <h2>📜 Статут</h2>
      <form method="post" action="${submitPath}${q}">
        <textarea name="full">${escapeHtml(text)}</textarea>
        <p><button type="submit">Зберегти</button></p>
      </form>
    </div>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}