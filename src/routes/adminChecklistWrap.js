// src/routes/adminChecklistWrap.js
// Checklist + Energy wrapper (HTML)
// Авторизація: ?s=<WEBHOOK_SECRET або TG_WEBHOOK_SECRET або TELEGRAM_SECRET_TOKEN>
// Додатково: ?u=<telegram_user_id> (опційно)

import { checklistHtml } from "../lib/kvChecklist.js";

const CTYPE_HTML = { headers: { "content-type": "text/html; charset=utf-8" } };
const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });

function secFromEnv(env) {
  return (
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    ""
  );
}
function isAuthed(url, env) {
  const s = url.searchParams.get("s") || "";
  const exp = secFromEnv(env);
  return !!exp && s === exp;
}

function unauthorized() {
  return json({ ok: false, error: "unauthorized" }, { status: 401 });
}
function okHtml(s) {
  return new Response(s, CTYPE_HTML);
}

export async function handleAdminChecklistWithEnergy(req, env, url) {
  if (!isAuthed(url, env)) return unauthorized();

  const secret = url.searchParams.get("s") || "";
  const u = (url.searchParams.get("u") || env.TELEGRAM_ADMIN_ID || "").trim();

  // Базовий HTML чекліста (вставляємо як є)
  const inner = await checklistHtml(env).catch(() => "<h3>Checklist</h3>");

  // Вставляємо зверху iframe з енергією
  const energySrc =
    `/admin/energy/html?s=${encodeURIComponent(secret)}${u ? `&u=${encodeURIComponent(u)}` : ""}`;

  const markup = `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Checklist + Energy</title>
  <style>
    body{margin:0;background:#0b0b0b;color:#e7e7e7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    .wrap{max-width:980px;margin:0 auto;padding:12px}
    .card{background:#121212;border-radius:14px;padding:12px;margin:10px 0;border:1px solid #1f1f1f}
    .row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#111;color:#fff;text-decoration:none;border:1px solid #222}
    iframe{width:100%;height:260px;border:0;border-radius:12px;overflow:hidden;background:#fff}
    .muted{opacity:.85}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="row">
        <h2 style="margin:0">📝 Checklist</h2>
        <div class="row" style="gap:8px">
          <a class="btn" href="/admin/checklist/html?s=${encodeURIComponent(secret)}">Оригінальний вигляд</a>
          <a class="btn" href="${energySrc}" target="_blank">Відкрити Energy окремо</a>
        </div>
      </div>
      <div class="muted" style="margin-top:6px">Віджет енергії (оновлюється кнопкою в блоці)</div>
      <iframe src="${energySrc}" title="Energy"></iframe>
    </div>

    <div class="card">
      ${inner}
    </div>
  </div>
</body>
</html>`;

  return okHtml(markup);
}