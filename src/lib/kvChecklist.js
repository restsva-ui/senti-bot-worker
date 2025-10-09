// src/lib/kvChecklist.js
// KV-чекліст + архіви (працює на TODO_KV)

const CHECK_KEY = "senti:checklist";
const ARCH_PREFIX = "senti:archive:";

// ---------- utils ----------
function ensureKv(env) {
  const kv = env.TODO_KV;
  if (!kv) throw new Error("TODO_KV binding missing");
  return kv;
}
function nowIso() {
  return new Date().toISOString();
}
function escHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// ---------- checklist core ----------
export async function readChecklist(env) {
  const kv = ensureKv(env);
  const txt = await kv.get(CHECK_KEY);
  return txt || "# Senti checklist\n";
}

export async function writeChecklist(env, body) {
  const kv = ensureKv(env);
  await kv.put(CHECK_KEY, String(body ?? ""));
  return true;
}

export async function appendChecklist(env, line) {
  const kv = ensureKv(env);
  const cur = (await kv.get(CHECK_KEY)) || "# Senti checklist\n";
  const next = `${cur}${cur.endsWith("\n") ? "" : "\n"}- ${line}\n`;
  await kv.put(CHECK_KEY, next);
  return true;
}

// ---------- archives in KV ----------
/**
 * Зберегти файл у KV.
 * @param {any} env
 * @param {File|Blob} file
 * @returns {{key:string,name:string,ct:string,size:number}}
 */
export async function saveArchive(env, file) {
  const kv = ensureKv(env);
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("saveArchive: invalid file");
  }
  const name = file.name || `upload-${Date.now()}.bin`;
  const ct = file.type || "application/octet-stream";
  const buf = await file.arrayBuffer();
  const size = buf.byteLength;

  const key = `${ARCH_PREFIX}${Date.now()}:${name}`;
  await kv.put(key, buf, {
    expirationTtl: 60 * 60 * 24 * 365, // 1 рік
    metadata: { name, ct, size },
  });

  return { key, name, ct, size };
}

/**
 * Прочитати файл з KV.
 * @param {any} env
 * @param {string} key
 * @returns {{buf:ArrayBuffer, name:string, ct:string}|null}
 */
export async function getArchive(env, key) {
  const kv = ensureKv(env);
  if (!key || !key.startsWith(ARCH_PREFIX)) return null;
  const { value, metadata } = await kv.getWithMetadata(key, "arrayBuffer");
  if (!value) return null;
  const name = (metadata && metadata.name) || "file.bin";
  const ct = (metadata && metadata.ct) || "application/octet-stream";
  return { buf: value, name, ct };
}

// ---------- HTML UI ----------
export async function checklistHtml(env, secret) {
  const body = await readChecklist(env);
  const linkDlNote =
    "https://emoji.gg/assets/emoji/5965-sticky-note.png"; // просто маленька іконка у вкладці

  // Порти для POST: /admin/checklist/append, /admin/checklist/save, /admin/checklist/upload
  // Секрет пробрасываем у query ?s=...
  const q = `?s=${encodeURIComponent(secret || "")}`;

  return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Senti Checklist</title>
  <link rel="icon" href="${linkDlNote}">
  <style>
    body{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;margin:14px;}
    .row{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
    input[type=text]{flex:1;min-width:220px;padding:8px;border:1px solid #ccc;border-radius:8px}
    textarea{width:100%;min-height:70vh;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:16px;line-height:1.5}
    button{padding:8px 12px;border:1px solid #ccc;border-radius:8px;background:#f7f7f7;cursor:pointer}
    button:hover{background:#eee}
    .muted{color:#666;font-size:12px}
    .card{border:1px solid #eee;border-radius:10px;padding:10px}
  </style>
</head>
<body>
  <h3>📝 Senti Checklist</h3>

  <div class="card">
    <form class="row" method="post" action="/admin/checklist/append${q}">
      <input name="line" type="text" placeholder="Додати рядок у чекліст…" />
      <button type="submit">Append</button>
      <span class="muted">UTC: ${escHtml(nowIso())}</span>
    </form>

    <form class="row" method="post" action="/admin/checklist/upload${q}" enctype="multipart/form-data">
      <input type="file" name="file" />
      <button type="submit">Upload to KV</button>
      <span class="muted">збережеться як архів у KV</span>
    </form>
  </div>

  <form method="post" action="/admin/checklist/save${q}">
    <p class="muted">Редагуй текст і натисни «Зберегти цілком»</p>
    <textarea name="body" spellcheck="false">${escHtml(body)}</textarea>
    <div class="row" style="margin-top:8px">
      <button type="submit">💾 Зберегти цілком</button>
      <a class="muted" href="/admin/checklist/html${q}">Оновити сторінку</a>
    </div>
  </form>
</body>
</html>`;
}