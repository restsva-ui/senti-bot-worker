// KV-чеклист + архіви для Senti
// Використовує binding TODO_KV
// Ключі:
//   checklist_md         — сам чеклист (markdown)
//   archive:<ts>_<name>  — json з b64 вмістом архіву

const CHECK_KEY = "checklist_md";
const ARCHIVE_PREFIX = "archive:";

// ---------- базові операції з чеклистом ----------

export async function readChecklist(env) {
  const v = await env.TODO_KV.get(CHECK_KEY);
  return v ?? "# Senti checklist\n";
}

export async function writeChecklist(env, text) {
  await env.TODO_KV.put(CHECK_KEY, text ?? "");
  return true;
}

export async function appendChecklist(env, line) {
  const cur = await readChecklist(env);
  const next = (cur.endsWith("\n") ? cur : cur + "\n") + `- ${line}\n`;
  await writeChecklist(env, next);
  return true;
}

// ---------- архіви в KV ----------

export async function listArchives(env, limit = 100) {
  const list = await env.TODO_KV.list({ prefix: ARCHIVE_PREFIX, limit });
  const out = [];
  for (const k of list.keys) {
    try {
      const raw = await env.TODO_KV.get(k.name);
      const obj = JSON.parse(raw);
      out.push({
        key: k.name,
        name: obj.name,
        size: obj.size,
        ts: obj.ts,
        ct: obj.ct || "application/zip",
      });
    } catch {
      // якщо колись покладено не json
      out.push({
        key: k.name,
        name: k.name.slice(ARCHIVE_PREFIX.length),
        size: 0,
        ts: 0,
        ct: "application/octet-stream",
      });
    }
  }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}

// збереження файлу з <input type=file>
export async function saveArchive(env, file) {
  const buf = await file.arrayBuffer();
  return saveArchiveFromBuffer(env, buf, file.name || "archive.zip", file.type || "application/zip");
}

// збереження з ArrayBuffer/Uint8Array
export async function saveArchiveFromBuffer(env, bufLike, name, ct = "application/zip") {
  const buf = bufLike instanceof ArrayBuffer ? new Uint8Array(bufLike) : new Uint8Array(bufLike.buffer ?? bufLike);
  const b64 = btoa(String.fromCharCode(...buf));
  const meta = {
    name: sanitizeName(name || "archive.zip"),
    size: buf.byteLength,
    ts: Date.now(),
    ct,
    b64, // власне вміст
  };
  const key = `${ARCHIVE_PREFIX}${meta.ts}_${meta.name}`;
  await env.TODO_KV.put(key, JSON.stringify(meta));
  return { key, name: meta.name, size: meta.size, ts: meta.ts, ct: meta.ct };
}

export async function getArchive(env, key) {
  if (!key?.startsWith(ARCHIVE_PREFIX)) throw new Error("invalid key");
  const raw = await env.TODO_KV.get(key);
  if (!raw) return null;
  const obj = JSON.parse(raw);
  const bin = Uint8Array.from(atob(obj.b64), (c) => c.charCodeAt(0));
  return {
    name: obj.name,
    size: obj.size,
    ct: obj.ct || "application/zip",
    buf: bin.buffer,
  };
}

function sanitizeName(n) {
  return String(n).replace(/[^\w.\-]+/g, "_").slice(0, 128) || "archive.zip";
}

// ---------- HTML (очікуване ім'я: checklistHtml) ----------
// Повертає готовий HTML (рядок). Підтягує контент самостійно з KV.
export async function checklistHtml(env, secret) {
  const text = await readChecklist(env);
  const archives = await listArchives(env);

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const items =
    archives.length === 0
      ? `<li><em>Архівів ще немає.</em></li>`
      : archives
          .map(
            (a) =>
              `<li><a href="/admin/checklist/archive?id=${encodeURIComponent(a.key)}&s=${encodeURIComponent(
                secret
              )}">${esc(a.name)}</a> — ${a.size} B — ${new Date(a.ts).toLocaleString()}</li>`
          )
          .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Senti Checklist</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    body{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Apple Color Emoji","Segoe UI Emoji";}
    .bar{display:flex;gap:.5rem;align-items:center;margin:.5rem 0}
    textarea{width:100%;min-height:60vh;font:16px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .card{border:1px solid #ddd;border-radius:12px;padding:12px;margin-top:8px}
    button,input[type="submit"]{padding:.5rem .75rem;border-radius:10px;border:1px solid #aaa;background:#fff}
    .muted{color:#666}
  </style>
</head>
<body>
  <h2>🧾 Senti checklist</h2>

  <form class="bar" method="post" action="/admin/checklist/append?s=${encodeURIComponent(secret)}">
    <input name="line" placeholder="Додати рядок у чеклист…" style="flex:1"/>
    <input type="submit" value="Append"/>
  </form>

  <div class="card">
    <form method="post" action="/admin/checklist/save?s=${encodeURIComponent(secret)}">
      <textarea name="body">${esc(text)}</textarea>
      <div class="bar">
        <input type="submit" value="Зберегти цілком"/>
        <span class="muted">— повністю замінює вміст</span>
      </div>
    </form>
  </div>

  <h3>📦 Архіви</h3>
  <div class="card">
    <form method="post" action="/admin/checklist/upload?s=${encodeURIComponent(secret)}" enctype="multipart/form-data">
      <input type="file" name="file" accept=".zip,.tar,.tgz,.gz,.txt,.md,.json" required/>
      <input type="submit" value="Завантажити в KV"/>
    </form>
    <ul>${items}</ul>
  </div>
</body>
</html>`;
}