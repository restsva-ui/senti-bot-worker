// src/lib/kvChecklist.js
// Storage + HTML for Checklist / Statut in CHECKLIST_KV and Repo view from R2
//
// Keys in CHECKLIST_KV:
//   - checklist:text    -> string (markdown/plain)
//   - checklist:log     -> newline-delimited audit
//   - statut:text       -> string (markdown/plain)
//   - archive:<ts>      -> archived checklist snapshot
//
// R2 (optional):
//   - LEARN_BUCKET with prefixes:
//       repo/*   - "особистий репозиторій з архівами"
//       learn/*  - навчальні файли (перелік віддаємо окремо в index.js)
//
// All HTML is mobile-first, dark theme, no external deps.

const K_CHECKLIST = "checklist:text";
const K_CHECKLIST_LOG = "checklist:log";
const K_STATUT = "statut:text";

// ───────────────────────────── Utils ─────────────────────────────

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function nowISO() {
  return new Date().toISOString();
}

async function kvGet(kv, key, def = "") {
  try { return (await kv.get(key)) ?? def; } catch { return def; }
}

async function kvPut(kv, key, val) {
  try { await kv.put(key, val); } catch {}
}

async function appendChecklistLog(env, line) {
  const kv = env.CHECKLIST_KV;
  if (!kv) return;
  try {
    const prev = await kv.get(K_CHECKLIST_LOG);
    const stamp = `[${nowISO()}] ${line}`;
    const joined = prev ? (prev + "\n" + stamp) : stamp;
    // обмежуємо ~1000 рядків, щоб не роздувать
    const lines = joined.split("\n");
    const tail = lines.slice(-1000).join("\n");
    await kv.put(K_CHECKLIST_LOG, tail);
  } catch {}
}

function baseCss() {
  return `
  <style>
    :root{color-scheme:dark}
    *{box-sizing:border-box}
    body{margin:0;background:#0b0f14;color:#e6edf3;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial,sans-serif}
    a{color:#8ab4f8;text-decoration:none}
    a:hover{text-decoration:underline}
    .wrap{max-width:980px;margin:0 auto;padding:12px}
    .row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .card{background:#11161d;border:1px solid #1f2937;border-radius:12px;padding:14px;margin:10px 0}
    .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3}
    .btn:hover{background:#2a3f55}
    .muted{opacity:.8}
    textarea,input{width:100%;padding:10px;border-radius:10px;border:1px solid #2d4f6b;background:#0b1117;color:#e6edf3}
    textarea{min-height:160px}
    pre{white-space:pre-wrap;background:#0b1117;border:1px solid #1f2937;border-radius:10px;padding:10px}
    .mono{font-family:ui-monospace,Consolas,Menlo,monospace}
    @media (max-width:760px){ .wrap{padding:10px} }
  </style>`;
}

// ───────────────────────── Checklist core ─────────────────────────

export async function readChecklist(env) {
  return kvGet(env.CHECKLIST_KV, K_CHECKLIST, "");
}

export async function writeChecklist(env, text) {
  await kvPut(env.CHECKLIST_KV, K_CHECKLIST, String(text || ""));
  await appendChecklistLog(env, `replace checklist (${(String(text||"")).length} chars)`);
}

export async function appendChecklist(env, line) {
  const cur = await readChecklist(env);
  const next = (cur ? cur + "\n" : "") + String(line || "");
  await kvPut(env.CHECKLIST_KV, K_CHECKLIST, next);
  await appendChecklistLog(env, `append checklist line (${(String(line||"")).length} chars)`);
}

export async function saveArchive(env, label = "manual") {
  const cur = await readChecklist(env);
  const ts = nowISO().replace(/[:.]/g, "-");
  const key = `archive:${ts}`;
  await kvPut(env.CHECKLIST_KV, key, cur);
  await appendChecklistLog(env, `archive saved: ${key} (${label})`);
  return key;
}

export async function checklistHtml(env) {
  const css = baseCss();
  const text = await readChecklist(env);
  const log = await kvGet(env.CHECKLIST_KV, K_CHECKLIST_LOG, "");
  const sec = env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || "";

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Checklist</title>
${css}
</head>
<body>
  <div class="wrap">
    <div class="card row">
      <h2 style="margin:0">📝 Checklist</h2>
      <div class="row" style="gap:8px">
        <a class="btn" href="/admin/checklist/html?s=${encodeURIComponent(sec)}">Оновити</a>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px">Поточний текст</h3>
      <pre>${esc(text || "—")}</pre>
      <details class="muted" style="margin-top:10px">
        <summary>Лог змін</summary>
        <pre class="mono" style="max-height:280px;overflow:auto">${esc(log || "—")}</pre>
      </details>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px">Оновити</h3>
      <form method="post" action="/admin/checklist?replace=1&s=${encodeURIComponent(sec)}">
        <p><textarea name="text" placeholder="Встав повний текст чеклиста">${esc(text)}</textarea></p>
        <p><button class="btn" type="submit">💾 Замінити</button></p>
      </form>
      <form method="post" action="/admin/checklist?append=1&s=${encodeURIComponent(sec)}" style="margin-top:10px">
        <p><input name="line" placeholder="Додати рядок"/></p>
        <p><button class="btn" type="submit">＋ Додати</button></p>
      </form>
      <form method="post" action="/admin/checklist?archive=1&s=${encodeURIComponent(sec)}" style="margin-top:10px">
        <button class="btn" type="submit">🗄️ Архівувати</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

// ───────────────────────── Statut core ─────────────────────────

export async function readStatut(env) {
  return kvGet(env.CHECKLIST_KV, K_STATUT, "");
}

export async function writeStatut(env, text) {
  await kvPut(env.CHECKLIST_KV, K_STATUT, String(text || ""));
}

export async function appendStatut(env, line) {
  const cur = await readStatut(env);
  const next = (cur ? cur + "\n" : "") + String(line || "");
  await kvPut(env.CHECKLIST_KV, K_STATUT, next);
}

export async function statutHtml(env) {
  const css = baseCss();
  const text = await readStatut(env);
  const sec = env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || "";

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Statut</title>
${css}
</head>
<body>
  <div class="wrap">
    <div class="card row">
      <h2 style="margin:0">📜 Статут</h2>
      <div class="row" style="gap:8px">
        <a class="btn" href="/admin/statut/html?s=${encodeURIComponent(sec)}">Оновити</a>
      </div>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px">Поточний текст</h3>
      <pre>${esc(text || "—")}</pre>
    </div>

    <div class="card">
      <h3 style="margin:0 0 8px">Оновити</h3>
      <form method="post" action="/admin/statut?replace=1&s=${encodeURIComponent(sec)}">
        <p><textarea name="text" placeholder="Встав повний текст статуту">${esc(text)}</textarea></p>
        <p><button class="btn" type="submit">💾 Замінити</button></p>
      </form>
      <form method="post" action="/admin/statut?append=1&s=${encodeURIComponent(sec)}" style="margin-top:10px">
        <p><input name="line" placeholder="Додати рядок"/></p>
        <p><button class="btn" type="submit">＋ Додати</button></p>
      </form>
    </div>
  </div>
</body>
</html>`;
}

// ───────────────────────── Repo (R2) HTML ─────────────────────────

export async function repoHtml(env) {
  const css = baseCss();
  const bucket = env.LEARN_BUCKET;
  if (!bucket) {
    return `<!doctype html>
<html lang="uk"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Repo (R2)</title>${css}</head>
<body><div class="wrap">
  <div class="card">R2 не прив’язано (LEARN_BUCKET).</div>
</div></body></html>`;
  }

  // зберемо список repo/*
  const items = [];
  let cursor, guard = 0;
  do {
    const r = await bucket.list({ prefix: "repo/", limit: 500, cursor });
    (r.objects || []).forEach(o => items.push(o));
    cursor = r.truncated ? r.cursor : undefined;
    guard++;
  } while (cursor && guard < 20);

  // сортуємо новіші першими
  items.sort((a,b)=> (a.key < b.key ? 1 : -1));

  const rows = items.length ? items.map(o => {
    const size = (o.size || 0).toLocaleString("uk-UA");
    const uploaded = o.uploaded ? new Date(o.uploaded).toISOString() : "";
    return `<tr>
      <td class="mono" style="word-break:break-all">${esc(o.key)}</td>
      <td>${size} B</td>
      <td class="mono">${esc(uploaded)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="3" class="mono">Порожньо.</td></tr>`;

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Repo (R2)</title>
${css}
</head>
<body>
  <div class="wrap">
    <div class="card row">
      <h2 style="margin:0">📁 Repo (R2: repo/*)</h2>
      <a class="btn" href="/admin/repo/html">Оновити</a>
    </div>

    <div class="card" style="overflow:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr><th style="text-align:left;padding:8px;border-bottom:1px solid #1f2937">Key</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #1f2937">Size</th>
              <th style="text-align:left;padding:8px;border-bottom:1px solid #1f2937">Uploaded</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}