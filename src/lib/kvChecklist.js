// src/lib/kvChecklist.js
// KV-backed checklist/statut utilities with robust fallbacks and a simple HTML UI.

const CHECKLIST_KEY = "service:checklist";
const STATUT_KEY = "service:statut";

// Старі архіви (текст чекліста)
const ARCHIVE_PREFIX = "archive:checklist:";
// Нові архіви (ZIP з «мозком»)
const REPO_PREFIX = "senti_archive/";

// --- small helpers -----------------------------------------------------------
function fmtNow() { return new Date().toISOString(); }

async function safeGet(kv, key, fallback = "") {
  try {
    const v = await kv.get(key);
    return v ?? fallback;
  } catch (e) {
    console.error("[kvChecklist.get]", key, e?.message || e);
    return fallback;
  }
}
async function safePut(kv, key, value, options) {
  try {
    await kv.put(key, value, options);
    return true;
  } catch (e) {
    console.error("[kvChecklist.put]", key, e?.message || e);
    return false;
  }
}

// --- public API: checklist ---------------------------------------------------
export async function readChecklist(env) {
  if (!env?.CHECKLIST_KV) return "";
  return await safeGet(env.CHECKLIST_KV, CHECKLIST_KEY, "");
}

export async function writeChecklist(env, text) {
  if (!env?.CHECKLIST_KV) return false;
  return await safePut(env.CHECKLIST_KV, CHECKLIST_KEY, String(text || ""));
}

export async function appendChecklist(env, line) {
  if (!env?.CHECKLIST_KV) return false;
  const cur = await readChecklist(env);
  const next = (cur ? cur + "\n" : "") + String(line || "").trim();
  return await writeChecklist(env, next);
}

// --- public API: statut ------------------------------------------------------
export async function readStatut(env) {
  if (!env?.CHECKLIST_KV) return "";
  return await safeGet(env.CHECKLIST_KV, STATUT_KEY, "");
}

export async function writeStatut(env, html) {
  if (!env?.CHECKLIST_KV) return false;
  return await safePut(env.CHECKLIST_KV, STATUT_KEY, String(html || ""));
}

// --- archive (text & repo zips) ---------------------------------------------
export async function listArchives(env) {
  if (!env?.CHECKLIST_KV || !env.CHECKLIST_KV.list) return [];
  try {
    const [a, b] = await Promise.all([
      env.CHECKLIST_KV.list({ prefix: REPO_PREFIX }).catch(() => ({ keys: [] })),
      env.CHECKLIST_KV.list({ prefix: ARCHIVE_PREFIX }).catch(() => ({ keys: [] })),
    ]);
    const names = []
      .concat((a.keys || []).map(k => k.name))
      .concat((b.keys || []).map(k => k.name));
    // від нового до старого за ім'ям (ISO-мітки збережені у ключах)
    return names.sort().reverse();
  } catch (e) {
    console.error("[kvChecklist.listArchives]", e?.message || e);
    return [];
  }
}

export async function getArchive(env, key) {
  if (!env?.CHECKLIST_KV) return "";
  return await safeGet(env.CHECKLIST_KV, String(key || ""), "");
}

/**
 * saveArchive:
 * 1) Якщо передано (key, bodyBase64) — зберігаємо ZIP «мозку» в REPO_PREFIX.
 * 2) Інакше — робимо текстовий snapshot чекліста під ARCHIVE_PREFIX + timestamp.
 */
export async function saveArchive(env, keyOrNote = "manual", bodyBase64) {
  if (!env?.CHECKLIST_KV) return false;

  // режим ZIP
  if (bodyBase64) {
    const key = String(keyOrNote || "").startsWith(REPO_PREFIX)
      ? String(keyOrNote)
      : `${REPO_PREFIX}${String(keyOrNote || "")}`;
    return await safePut(env.CHECKLIST_KV, key, String(bodyBase64));
  }

  // режим текстового snapshot
  const stamp = fmtNow().replace(/[:.]/g, "-");
  const key = `${ARCHIVE_PREFIX}${stamp}__${String(keyOrNote)}`;
  const body = await readChecklist(env);
  return await safePut(env.CHECKLIST_KV, key, body);
}

// --- HTML views --------------------------------------------------------------
export async function statutHtml(env) {
  const body = await readStatut(env);
  const sec = env?.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Statut</title>
<style>
  body{font:14px/1.4 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu,sans-serif;padding:16px;background:#0b0b0b;color:#e6e6e6}
  a{color:#7dd3fc}
  .wrap{max-width:900px;margin:0 auto}
  .card{background:#111;border:1px solid #222;border-radius:12px;padding:16px}
  h1{margin:0 0 12px;font-size:18px}
  textarea{width:100%;min-height:300px;background:#0d0d0d;color:#eaeaea;border:1px solid #2a2a2a;border-radius:10px;padding:10px}
  .row{display:flex;gap:8px;margin:8px 0;flex-wrap:wrap}
  button,input[type=submit]{background:#1f2937;border:1px solid #334155;color:#e5e7eb;border-radius:10px;padding:8px 12px}
</style>
</head>
<body>
<div class="wrap">
  <h1>📜 Statut</h1>
  <div class="card">
    <form method="post" action="/admin/statut?save=1">
      <textarea name="text" placeholder="HTML...">${body || ""}</textarea>
      <div class="row">
        <input type="submit" value="Зберегти"/>
        <a href="/admin/checklist/html${sec}">➡️ до Checklist</a>
      </div>
    </form>
  </div>
</div>
</body>
</html>`;
}

export async function checklistHtml(env) {
  const body = await readChecklist(env);
  const empty = !String(body).trim();
  const last200 = (body || "").split(/\n/).slice(-200).join("\n"); // show last 200 lines

  // 🔒 якщо є секрет — додаємо його до захищених лінків/тригерів
  const sec = env?.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
  const repoHref = `/admin/repo/html${sec}`;
  const statutHref = `/admin/statut/html${sec}`;
  const improveAction = `/ai/improve${sec}`;

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Checklist</title>
<meta http-equiv="refresh" content="15"> <!-- auto refresh every 15s -->
<style>
  body{font:14px/1.4 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu,sans-serif;padding:16px;background:#0b0b0b;color:#e6e6e6}
  a{color:#7dd3fc}
  .wrap{max-width:900px;margin:0 auto}
  .card{background:#111;border:1px solid #222;border-radius:12px;padding:12px}
  h1{margin:0 0 12px;font-size:18px}
  textarea{width:100%;min-height:300px;background:#0d0d0d;color:#eaeaea;border:1px solid #2a2a2a;border-radius:10px;padding:10px}
  input[type=text]{width:100%;background:#0d0d0d;color:#eaeaea;border:1px solid #2a2a2a;border-radius:10px;padding:10px}
  .row{display:flex;gap:8px;margin:8px 0;flex-wrap:wrap}
  button,input[type=submit]{background:#1f2937;border:1px solid #334155;color:#e5e7eb;border-radius:10px;padding:8px 12px}
  .muted{opacity:.7}
  .danger{background:#3a1f1f;border-color:#5b2b2b}
</style>
</head>
<body>
<div class="wrap">
  <h1>📝 Checklist</h1>
  <div class="row">
    <a href="${repoHref}">📁 Відкрити Repo</a>
    <a href="${statutHref}">📜 Статут</a>
    <form method="post" action="/admin/checklist?archive=1">
      <button title="Зберегти знімок у архів">💾 Зберегти архів</button>
    </form>
    ${
      env?.WEBHOOK_SECRET
        ? `<form method="post" action="${improveAction}">
             <button class="danger" title="Запустити нічний агент прямо зараз">🌙 Запустити нічного агента</button>
           </form>`
        : `<span class="muted">🌙 Для ручного запуску нічного агента задай WEBHOOK_SECRET у ENV</span>`
    }
    <span class="muted">оновлюється кожні 15с</span>
  </div>

  <div class="card">
    ${empty ? '<div class="muted">(поки немає записів)</div>' : ''}
    <form method="post" action="/admin/checklist?replace=1">
      <textarea name="text" placeholder="повний текст">${last200}</textarea>
      <div class="row">
        <input type="submit" value="Зберегти"/>
      </div>
    </form>
  </div>

  <div class="card" style="margin-top:10px">
    <form method="post" action="/admin/checklist?append=1">
      <input type="text" name="line" placeholder="новий рядок…"/>
      <div class="row">
        <input type="submit" value="Додати рядок"/>
      </div>
    </form>
  </div>
</div>
</body>
</html>`;
}