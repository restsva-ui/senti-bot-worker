// src/lib/kvChecklist.js
// Чекліст + Статут (KV) + Repo/архіви (R2) + легкі HTML-рендери.
// Без зовнішніх залежностей — сумісно з Cloudflare Workers.

/* =========================== УТИЛІТИ ============================ */

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fmtLocal(dt, tz) {
  try {
    return new Date(dt).toLocaleString("uk-UA", {
      timeZone: tz || "Europe/Kyiv",
      hour12: false,
    });
  } catch {
    return String(dt);
  }
}

function bytesFmt(n) {
  const b = Number(n || 0);
  if (b < 1024) return `${b} B`;
  const kb = b / 1024; if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024; if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024; return `${gb.toFixed(2)} GB`;
}

function pickKV(env) {
  // Гнучко підхоплюємо будь-який з доступних KV, щоб не падати на деві
  return env.CHECKLIST_KV || env.STATE_KV || env.TODO_KV || env.LEARN_QUEUE_KV;
}

/* ==================== КЛЮЧІ ТА СХЕМА У KV ====================== */

// Checklist
const CHECK_TEXT = "checklist:text";
const CHECK_LOG  = "checklist:log";

// Statut
const STATUT_TEXT = "statut:text";
const STATUT_LOG  = "statut:log";

/* =========================== CHECKLIST ========================== */

export async function readChecklist(env) {
  const kv = pickKV(env);
  return (await kv.get(CHECK_TEXT)) || "";
}

export async function writeChecklist(env, text) {
  const kv = pickKV(env);
  await kv.put(CHECK_TEXT, String(text || ""));
  await appendChecklistLog(env, `✍️ Checklist replaced (${(String(text||"")).length} chars)`);
}

export async function appendChecklist(env, line) {
  const cur = await readChecklist(env);
  const next = cur ? `${cur}\n${line}` : String(line || "");
  await writeChecklist(env, next);
  await appendChecklistLog(env, `➕ Checklist appended: ${String(line||"").slice(0,80)}`);
}

async function appendChecklistLog(env, msg) {
  const kv = pickKV(env);
  const cur = (await kv.get(CHECK_LOG)) || "";
  const now = fmtLocal(Date.now(), env.TIMEZONE);
  const line = `[${now}] ${msg}`;
  const next = cur ? `${line}\n${cur}` : line;
  // обмежимо лог до ~20к символів, щоб не роздувати KV
  await kv.put(CHECK_LOG, next.slice(0, 20000));
}

export async function readChecklistLog(env) {
  const kv = pickKV(env);
  return (await kv.get(CHECK_LOG)) || "";
}

/* ============================ STATUT ============================ */

export async function readStatut(env) {
  const kv = pickKV(env);
  return (await kv.get(STATUT_TEXT)) || "";
}

export async function writeStatut(env, text) {
  const kv = pickKV(env);
  await kv.put(STATUT_TEXT, String(text || ""));
  await appendStatutLog(env, `✍️ Statut replaced (${(String(text||"")).length} chars)`);
}

export async function appendStatut(env, line) {
  const cur = await readStatut(env);
  const next = cur ? `${cur}\n${line}` : String(line || "");
  await writeStatut(env, next);
  await appendStatutLog(env, `➕ Statut appended: ${String(line||"").slice(0,80)}`);
}

async function appendStatutLog(env, msg) {
  const kv = pickKV(env);
  const cur = (await kv.get(STATUT_LOG)) || "";
  const now = fmtLocal(Date.now(), env.TIMEZONE);
  const line = `[${now}] ${msg}`;
  const next = cur ? `${line}\n${cur}` : line;
  await kv.put(STATUT_LOG, next.slice(0, 20000));
}

export async function readStatutLog(env) {
  const kv = pickKV(env);
  return (await kv.get(STATUT_LOG)) || "";
}

/* ============================ REPO (R2) =========================
   Наш “репозиторій з архівами на html”.
   Зберігаємо архіви у R2 під префіксом: repo/<YYYY-MM-DD>/<timestamp>_<name>
   Також у цьому ж модулі є функція saveArchive(env, reason), яка
   зберігає актуальний Checklist у вигляді txt-файла до R2 (для бекапу).
================================================================= */

function r2(env) { return env?.LEARN_BUCKET || null; }

export async function listRepo(env, { prefix = "repo/", limit = 200 } = {}) {
  const bucket = r2(env);
  if (!bucket) return { ok: true, items: [], note: "No R2 binding" };
  const items = [];
  let cursor = undefined;
  let safety = 0;
  do {
    // Cloudflare R2 API supports list with cursor
    const res = await bucket.list({ prefix, limit: Math.min(1000, limit), cursor });
    for (const o of res.objects || []) {
      items.push({
        key: o.key,
        size: o.size || 0,
        uploaded: o.uploaded || o.etag || "",
      });
      if (items.length >= limit) break;
    }
    cursor = res.truncated ? res.cursor : undefined;
    safety++;
  } while (cursor && items.length < limit && safety < 20);
  // Сортуємо новіше зверху
  items.sort((a, b) => (a.key < b.key ? 1 : -1));
  return { ok: true, items };
}

export async function putRepoFile(env, name, bytes, contentType = "application/octet-stream") {
  const bucket = r2(env);
  if (!bucket) return { ok: false, error: "R2 not bound (LEARN_BUCKET missing)" };
  const date = new Date();
  const day = date.toISOString().slice(0, 10);
  const safe = String(name || "file").replace(/[^\w.\-]+/g, "_").slice(0, 120);
  const key = `repo/${day}/${Date.now()}_${safe}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType } });
  return { ok: true, key };
}

/* ============ Бекап чекліста у R2 (архів) ====================== */

export async function saveArchive(env, reason = "manual") {
  const bucket = r2(env);
  const text = await readChecklist(env);
  if (!bucket || !text) {
    await appendChecklistLog(env, `⛔ archive skipped (bucket:${!!bucket}, text:${text ? "yes" : "no"})`);
    return { ok: false, skipped: true };
  }
  const day = new Date().toISOString().slice(0, 10);
  const name = `checklist_${day}_${Date.now()}_${reason}.txt`;
  const key = `repo/${day}/${name.replace(/[^\w.\-]+/g, "_")}`;
  await bucket.put(key, new TextEncoder().encode(text), {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });
  await appendChecklistLog(env, `📦 archived checklist → R2:${key}`);
  return { ok: true, key };
}

/* =========================== HTML-VIEWS =========================
   Легкі рендери HTML для:
   - checklistHtml(env)
   - statutHtml(env)
   - repoHtml(env)
================================================================= */

function baseCss() {
  return `
<style>
  :root { color-scheme: dark; }
  html,body{margin:0;padding:0;background:#0b0f14;color:#e6edf3;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;}
  .wrap{max-width:980px;margin:0 auto;padding:12px}
  .card{background:#11161d;border:1px solid #1f2937;border-radius:12px;padding:14px;margin:10px 0}
  .row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
  .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3;text-decoration:none}
  .btn:hover{background:#2a3f55}
  .mono{font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace}
  textarea{width:100%;min-height:200px;border-radius:10px;border:1px solid #2d4f6b;background:#0b1117;color:#e6edf3;padding:10px}
  input[type="text"], input[type="url"]{width:100%;border-radius:10px;border:1px solid #2d4f6b;background:#0b1117;color:#e6edf3;padding:10px}
  pre{white-space:pre-wrap;background:#0b1117;border:1px solid #1f2937;border-radius:10px;padding:10px}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px;border-bottom:1px solid #1f2937}
  .muted{opacity:.8}
  /* Мобільна адаптація */
  @media (max-width: 720px){
    .wrap{padding:10px}
    .row{gap:8px}
    .btn{padding:9px 12px}
  }
</style>`;
}

/* --------------------------- Checklist -------------------------- */

export async function checklistHtml(env) {
  const css = baseCss();
  const txt = await readChecklist(env);
  const log = await readChecklistLog(env);

  return `
${css}
<div class="wrap">
  <div class="card row">
    <h2 style="margin:0">📝 Checklist</h2>
    <div class="row">
      <a class="btn" href="/admin/checklist/html">Оновити</a>
      <a class="btn" href="/admin/checklist/with-energy/html">Вигляд з енергією</a>
      <form method="post" action="/admin/checklist?archive" style="display:inline">
        <button class="btn" type="submit">📦 Архівувати в Repo (R2)</button>
      </form>
    </div>
  </div>

  <div class="card">
    <form method="post" action="/admin/checklist?replace">
      <p class="muted">Повна заміна</p>
      <textarea name="text" placeholder="Весь чекліст…">${esc(txt)}</textarea>
      <p><button class="btn" type="submit">💾 Зберегти</button></p>
    </form>
  </div>

  <div class="card">
    <form method="post" action="/admin/checklist?append">
      <p class="muted">Додати рядок</p>
      <input type="text" name="line" placeholder="Коротка зміна / пункт" />
      <p><button class="btn" type="submit">➕ Додати</button></p>
    </form>
  </div>

  <div class="card">
    <b>Останні оновлення</b>
    <pre>${esc(log || "—")}</pre>
  </div>
</div>`;
}

/* ---------------------------- Statut ---------------------------- */

export async function statutHtml(env) {
  const css = baseCss();
  const txt = await readStatut(env);
  const log = await readStatutLog(env);

  return `
${css}
<div class="wrap">
  <div class="card row">
    <h2 style="margin:0">📜 Статут</h2>
    <div class="row">
      <a class="btn" href="/admin/statut/html">Оновити</a>
    </div>
  </div>

  <div class="card">
    <form method="post" action="/admin/statut?replace">
      <p class="muted">Повна заміна</p>
      <textarea name="text" placeholder="Текст статуту…">${esc(txt)}</textarea>
      <p><button class="btn" type="submit">💾 Зберегти</button></p>
    </form>
  </div>

  <div class="card">
    <form method="post" action="/admin/statut?append">
      <p class="muted">Додати рядок</p>
      <input type="text" name="line" placeholder="Додати рядок" />
      <p><button class="btn" type="submit">➕ Додати</button></p>
    </form>
  </div>

  <div class="card">
    <b>Останні оновлення</b>
    <pre>${esc(log || "—")}</pre>
  </div>
</div>`;
}

/* ------------------------------ Repo ---------------------------- */

export async function repoHtml(env) {
  const css = baseCss();
  const bucket = r2(env);
  if (!bucket) {
    return `
${css}
<div class="wrap">
  <div class="card">
    <h2>📦 Repo</h2>
    <p class="muted">R2 bucket не прив’язаний (LEARN_BUCKET).</p>
  </div>
</div>`;
  }

  const listing = await listRepo(env, { prefix: "repo/", limit: 400 }).catch(() => ({ ok:false, items:[] }));
  const items = Array.isArray(listing.items) ? listing.items : [];

  const rows = items.length
    ? items.map(o => {
        const name = o.key.split("/").pop();
        const date = o.key.split("/")[1] || "";
        // Файли можна віддавати через signed URL або окремий endpoint; щоб не ускладнювати,
        // даємо технічний ключ (для подальших дій через API).
        return `<tr>
          <td class="mono">${esc(date)}</td>
          <td class="mono" style="word-break:break-all">${esc(name)}</td>
          <td>${bytesFmt(o.size)}</td>
          <td class="mono">${esc(o.uploaded||"")}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="4" class="muted">Порожньо.</td></tr>`;

  return `
${css}
<div class="wrap">
  <div class="card row">
    <h2 style="margin:0">📦 Repo (R2 /repo/*)</h2>
    <div class="row">
      <a class="btn" href="/admin/repo/html">Оновити</a>
      <form method="post" action="/admin/checklist?archive" style="display:inline">
        <button class="btn" type="submit">📥 Зберегти поточний Checklist у Repo</button>
      </form>
    </div>
  </div>

  <div class="card">
    <b>Файли</b>
    <div style="overflow:auto">
      <table>
        <thead><tr><th>Дата</th><th>Назва</th><th>Розмір</th><th>Uploaded</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="muted">Завантаження з UI можемо додати окремим endpoint-ом. Зараз архіви з’являються або через /admin/checklist?archive, або скриптами.</p>
  </div>
</div>`;
}