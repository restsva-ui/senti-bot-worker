// src/lib/kvChecklist.js
// Storage + HTML for Checklist / Statut in CHECKLIST_KV and Repo view from R2
//
// Keys in CHECKLIST_KV:
//   - checklist:text    -> string (markdown/plain)
//   - checklist:log     -> newline-delimited audit (включає і зміну статуту)
//   - statut:text       -> string (markdown/plain)
//   - archive:<ts>      -> archived checklist snapshot
//
// R2 (optional):
//   - LEARN_BUCKET with prefixes:
//       repo/*   - "особистий репозиторій з архівами"
//       learn/*  - навчальні файли
//
// Усі HTML — mobile-first, dark theme, без зовнішніх залежностей.

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
    // обмежуємо ~1000 рядків
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
    .badges{display:flex;gap:8px;flex-wrap:wrap}
    .badge{font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid #2d4f6b;background:#0c1722;display:inline-flex;gap:6px;align-items:center}
    textarea,input{width:100%;padding:10px;border-radius:10px;border:1px solid #2d4f6b;background:#0b1117;color:#e6edf3}
    textarea{min-height:160px}
    pre{white-space:pre-wrap;background:#0b1117;border:1px solid #1f2937;border-radius:10px;padding:10px}
    .mono{font-family:ui-monospace,Consolas,Menlo,monospace}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px;border-bottom:1px solid #1f2937;vertical-align:top}
    .nowrap{white-space:nowrap}
    @media (max-width:760px){ .wrap{padding:10px} table{font-size:14px} }
  </style>`;
}

function secretFromEnv(env){
  return env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || "";
}

function topLinksHtml(env, sectionTitle = ""){
  const sec = encodeURIComponent(secretFromEnv(env));
  const links = [
    `<a class="btn" href="/admin/learn/html?s=${sec}">🧠 Learn</a>`,
    `<a class="btn" href="/admin/repo/html?s=${sec}">📁 Repo</a>`,
    `<a class="btn" href="/admin/checklist/html?s=${sec}">📝 Checklist</a>`,
    `<a class="btn" href="/admin/statut/html?s=${sec}">📜 Статут</a>`
  ].join(" ");
  const publicHint = `<span class="muted">Readonly без секрету: додай <code>?public=1</code> до URL</span>`;
  return `
    <div class="card row">
      <h2 style="margin:0">${sectionTitle || "Панель"}</h2>
      <div class="row" style="gap:8px">${links}</div>
      <div class="muted" style="width:100%;margin-top:6px">${publicHint}</div>
    </div>
  `;
}

// ───────────────────────── Checklist core ─────────────────────────

export async function readChecklist(env) {
  return kvGet(env.CHECKLIST_KV, K_CHECKLIST, "");
}

export async function writeChecklist(env, text) {
  await kvPut(env.CHECKLIST_KV, K_CHECKLIST, String(text || ""));
  await appendChecklistLog(env, `checklist: replace (${(String(text||"")).length} chars)`);
}

export async function appendChecklist(env, line) {
  const cur = await readChecklist(env);
  const toAdd = String(line || "");
  const next = (cur ? (cur.endsWith("\n") ? cur : cur + "\n") : "") + toAdd;
  await kvPut(env.CHECKLIST_KV, K_CHECKLIST, next);
  await appendChecklistLog(env, `checklist: append (${toAdd.length} chars)`);
}

export async function saveArchive(env, label = "manual") {
  const cur = await readChecklist(env);
  const ts = nowISO().replace(/[:.]/g, "-");
  const key = `archive:${ts}`;
  await kvPut(env.CHECKLIST_KV, key, cur);
  await appendChecklistLog(env, `checklist: archive saved: ${key} (${label})`);
  return key;
}

export async function checklistHtml(env) {
  const css = baseCss();
  const text = await readChecklist(env);
  const log = await kvGet(env.CHECKLIST_KV, K_CHECKLIST_LOG, "");
  const sec = secretFromEnv(env);

  const lastUpdate = (() => {
    const L = (log || "").trim().split("\n");
    return L.length ? L[L.length - 1] : "—";
  })();

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
    ${topLinksHtml(env, "📝 Checklist")}

    <div class="card row">
      <div class="muted">Останнє оновлення: <span class="mono">${esc(lastUpdate)}</span></div>
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
  await appendChecklistLog(env, `statut: replace (${(String(text||"")).length} chars)`);
}

export async function appendStatut(env, line) {
  const cur = await readStatut(env);
  const toAdd = String(line || "");
  const next = (cur ? (cur.endsWith("\n") ? cur : cur + "\n") : "") + toAdd;
  await kvPut(env.CHECKLIST_KV, K_STATUT, next);
  await appendChecklistLog(env, `statut: append (${toAdd.length} chars)`);
}

export async function statutHtml(env) {
  const css = baseCss();
  const text = await readStatut(env);
  const log = await kvGet(env.CHECKLIST_KV, K_CHECKLIST_LOG, "");
  const sec = secretFromEnv(env);

  const lastUpdate = (() => {
    const L = (log || "").trim().split("\n");
    const last = L.reverse().find(x => /statut: /.test(x));
    return last || (L.length ? L[0] : "—");
  })();

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
    ${topLinksHtml(env, "📜 Статут")}

    <div class="card row">
      <div class="muted">Останнє оновлення: <span class="mono">${esc(lastUpdate)}</span></div>
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
      <details class="muted" style="margin-top:10px">
        <summary>Загальний лог (включно зі статутом)</summary>
        <pre class="mono" style="max-height:280px;overflow:auto">${esc(log || "—")}</pre>
      </details>
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
  ${topLinksHtml(env, "📁 Repo (R2)")}
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
    // Пряма роздача з R2 потребує public binding / signed URL — лишаємо ключ
    return `<tr>
      <td class="mono" style="word-break:break-all">${esc(o.key)}</td>
      <td class="nowrap">${size} B</td>
      <td class="mono nowrap">${esc(uploaded)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="3" class="mono">Порожньо.</td></tr>`;

  const sec = encodeURIComponent(secretFromEnv(env));

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
    ${topLinksHtml(env, "📁 Repo (R2: repo/*)")}

    <div class="card row">
      <div class="muted">Разом файлів: <b>${items.length}</b></div>
      <div class="row" style="gap:8px">
        <a class="btn" href="/admin/repo/html?s=${sec}">Оновити</a>
      </div>
    </div>

    <div class="card" style="overflow:auto">
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th class="nowrap">Size</th>
            <th class="nowrap">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <div class="muted" style="margin-top:8px">
        Публічний readonly: додай <code>?public=1</code> до URL (якщо дозволено у конфіг).
      </div>
    </div>
  </div>
</body>
</html>`;
}