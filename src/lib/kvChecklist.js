// src/lib/kvChecklist.js
// В одному модулі — чекліст + прості HTML-рендери Repo та Статуту.
// KV binding: CHECKLIST_KV (або STATE_KV як fallback)
// R2 binding (необов'язково): LEARN_BUCKET — для архівів (zip) та списку Repo.

function pickKV(env) {
  return env.CHECKLIST_KV || env.STATE_KV || env.LEARN_QUEUE_KV || env.TODO_KV;
}
function esc(s = "") {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function fmtLocal(dt, tz) {
  try {
    return new Date(dt).toLocaleString("uk-UA", { timeZone: tz || "Europe/Kyiv" });
  } catch { return String(dt); }
}

// ── ЧЕКЛІСТ ──────────────────────────────────────────────────────────────────
const KEY_TEXT = "checklist:text";
const KEY_LOG  = "checklist:log"; // простий журнал

export async function readChecklist(env) {
  const kv = pickKV(env);
  return (await kv?.get(KEY_TEXT, "text")) || "";
}

export async function writeChecklist(env, text) {
  const kv = pickKV(env);
  if (!kv) return;
  await kv.put(KEY_TEXT, String(text || ""));
  await appendLog(env, `✍️ replace checklist (${(String(text||"").length)} chars)`);
}

export async function appendChecklist(env, line) {
  const kv = pickKV(env);
  if (!kv) return;
  const cur = (await kv.get(KEY_TEXT, "text")) || "";
  const next = cur ? `${cur}\n${String(line || "")}` : String(line || "");
  await kv.put(KEY_TEXT, next);
  await appendLog(env, `➕ append "${String(line||"").slice(0,80)}"`);
}

async function appendLog(env, msg) {
  const kv = pickKV(env);
  if (!kv) return;
  const now = new Date().toISOString();
  const cur = (await kv.get(KEY_LOG, "text")) || "";
  const line = `[${fmtLocal(now, env.TIMEZONE)}] ${msg}`;
  const next = cur ? `${line}\n${cur}` : line;
  await kv.put(KEY_LOG, next.slice(0, 20000)); // обрізаємо довгі логи
}

export async function saveArchive(env, reason = "manual") {
  // Зберігає чекліст в R2 (як .txt) якщо LEARN_BUCKET під'єднаний.
  const bucket = env.LEARN_BUCKET;
  const text = await readChecklist(env);
  if (!bucket || !text) {
    await appendLog(env, `⛔ archive skipped (bucket:${!!bucket}, text:${text ? 'yes':'no'})`);
    return { ok:false, skipped:true };
  }
  const ts = new Date().toISOString().replace(/[:]/g, "-");
  const key = `senti_archive/${ts}__checklist__${reason}.txt`;
  await bucket.put(key, new Blob([text], { type: "text/plain; charset=utf-8" }));
  await appendLog(env, `📦 archived → ${key}`);
  return { ok: true, key };
}

export async function checklistHtml(env) {
  const kv = pickKV(env);
  const text = await readChecklist(env);
  const log  = (await kv?.get(KEY_LOG, "text")) || "";

  const tz = env.TIMEZONE || "Europe/Kyiv";
  const css = `
  <style>
    :root{--bg:#0b0f14;--panel:#11161d;--border:#1f2937;--txt:#e6edf3;--muted:#9aa7b2;--btn:#223449;--btnb:#2d4f6b}
    body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,Segoe UI,Roboto,sans-serif}
    .wrap{max-width:980px;margin:0 auto;padding:12px}
    .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;margin:10px 0}
    .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:var(--btn);border:1px solid var(--btnb);color:var(--txt);text-decoration:none}
    textarea{width:100%;min-height:220px;background:#0b1117;color:var(--txt);border:1px solid var(--border);border-radius:10px;padding:10px}
    pre{white-space:pre-wrap;background:#0b1117;border:1px solid var(--border);border-radius:10px;padding:10px}
  </style>`;

  const s = esc(env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || "");
  const links = `
    <div class="row">
      <a class="btn" href="/admin/repo/html">📂 Відкрити Repo</a>
      <a class="btn" href="/admin/statut/html">📜 Статут</a>
      <a class="btn" href="/admin/energy/html?s=${encodeURIComponent(s)}&u=${encodeURIComponent(env.TELEGRAM_ADMIN_ID||"")}">⚡ Відкрити Energy</a>
    </div>`;

  return `
  ${css}
  <div class="wrap">
    <h2>📝 Checklist</h2>
    ${links}

    <div class="card">
      <form method="post" action="/admin/checklist?replace=1">
        <textarea name="text" placeholder="Введіть повний чекліст…">${esc(text)}</textarea>
        <p><button class="btn" type="submit">💾 Зберегти</button>
           <button class="btn" formaction="/admin/checklist?archive=1">📦 Зберегти архів</button></p>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Журнал</h3>
      <pre>${esc(log)}</pre>
      <div class="muted">Показано у локальному часі (${esc(tz)}).</div>
    </div>
  </div>`;
}

// ── REPO (список архівів у R2) ───────────────────────────────────────────────
export async function repoHtml(env) {
  const bucket = env.LEARN_BUCKET;
  const css = `
  <style>
    :root{--bg:#0b0f14;--panel:#11161d;--border:#1f2937;--txt:#e6edf3;--muted:#9aa7b2}
    body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,Segoe UI,Roboto,sans-serif}
    .wrap{max-width:980px;margin:0 auto;padding:12px}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;margin:10px 0}
    a{color:#8ab4f8;text-decoration:none}
  </style>`;
  if (!bucket) {
    return `${css}<div class="wrap"><div class="card"><b>Repo</b><p class="muted">R2 bucket не під’єднано (LEARN_BUCKET).</p></div></div>`;
  }
  const objects = await bucket.list({ prefix: "senti_archive/" });
  const items = (objects?.objects || []).sort((a,b)=> (b.uploaded?.getTime?.()||0)-(a.uploaded?.getTime?.()||0));

  const list = items.length
    ? `<ul>${items.map(o => {
        const name = o.key.split("/").pop();
        const url  = bucket.getPublicUrl ? bucket.getPublicUrl(o.key) : `#${o.key}`;
        const when = o.uploaded ? ` (${esc(fmtLocal(o.uploaded, env.TIMEZONE))})` : "";
        return `<li><a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>${when}</li>`;
      }).join("")}</ul>`
    : `<p class="muted">Поки що немає архівів.</p>`;

  return `${css}<div class="wrap"><div class="card"><b>📁 Repo</b>${list}</div></div>`;
}

// ── СТАТУТ (беремо з KV ключа statut:html або statut:text) ──────────────────
export async function statutHtml(env) {
  const kv = pickKV(env);
  const htmlRaw = await kv?.get("statut:html", "text");
  const textRaw = await kv?.get("statut:text", "text");

  const css = `
  <style>
    :root{--bg:#0b0f14;--panel:#11161d;--border:#1f2937;--txt:#e6edf3}
    body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,Segoe UI,Roboto,sans-serif}
    .wrap{max-width:980px;margin:0 auto;padding:12px}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;margin:10px 0}
    pre{white-space:pre-wrap}
  </style>`;

  if (htmlRaw) {
    return `${css}<div class="wrap"><div class="card"><b>📜 Статут</b><div>${htmlRaw}</div></div></div>`;
  }
  if (textRaw) {
    return `${css}<div class="wrap"><div class="card"><b>📜 Статут</b><pre>${esc(textRaw)}</pre></div></div>`;
  }
  return `${css}<div class="wrap"><div class="card"><b>📜 Статут</b><p class="muted">Немає даних у KV (keys: <code>statut:html</code> або <code>statut:text</code>).</p></div></div>`;
}