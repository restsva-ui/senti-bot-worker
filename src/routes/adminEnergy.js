// src/routes/adminEnergy.js
// Адмін-інтерфейс для перегляду та скидання енергії користувача.
// Авторизація: ?s=<WEBHOOK_SECRET>
// Параметри: ?u=<telegram_user_id>
// HTML:  GET /admin/energy/html?s=...&u=...
// JSON:  GET /admin/energy?s=...&u=...
// Reset: POST /admin/energy/reset (body: u, s)

import { getEnergy, resetEnergy } from "../lib/energy.js";

const CTYPE_HTML = { headers: { "content-type": "text/html; charset=utf-8" } };
const CTYPE_JSON = { headers: { "content-type": "application/json; charset=utf-8" } };

const json = (data, init = {}) =>
  new Response(JSON.stringify(data, null, 2), { ...CTYPE_JSON, ...init });

function unauthorized() {
  return json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function notFound() {
  return json({ ok: false, error: "not_found" }, { status: 404 });
}

function requireSecret(env, url) {
  const s = url.searchParams.get("s") || "";
  const expected = String(env.WEBHOOK_SECRET || "");
  return s && expected && s === expected;
}

function pickUserId(env, url) {
  // якщо не передали ?u, беремо TELEGRAM_ADMIN_ID
  const u = url.searchParams.get("u") || env.TELEGRAM_ADMIN_ID || "";
  return String(u || "").trim();
}

function htmlPage({ s, u, energy, max, low, recoverPerMin }) {
  const linkSelf = (path, extra = "") =>
    `${path}?s=${encodeURIComponent(s)}${u ? `&u=${encodeURIComponent(u)}` : ""}${extra}`;
  return `<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin • Energy</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 16px; }
    .card { max-width: 720px; margin: 0 auto; padding: 16px; border: 1px solid #ddd; border-radius: 12px; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    .kv { display: grid; grid-template-columns: 180px 1fr; gap: 8px; margin: 12px 0; }
    .kv div { padding: 6px 8px; background: #fafafa; border-radius: 8px; }
    .actions { display: flex; gap: 8px; margin-top: 12px; }
    button, a.btn {
      display:inline-block; padding:10px 14px; border-radius: 10px; text-decoration:none;
      background:#111; color:white; border:0; cursor:pointer;
    }
    a.btn.secondary, button.secondary { background:#777; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⚡ Energy (user: ${u || "—"})</h1>
    <div class="kv">
      <div>Поточна енергія</div><div><b>${energy}</b> / ${max}</div>
      <div>Поріг low-mode</div><div>${low}</div>
      <div>Відновлення/хв</div><div>${recoverPerMin}</div>
    </div>

    <form method="post" action="/admin/energy/reset" class="actions">
      <input type="hidden" name="u" value="${u}"/>
      <input type="hidden" name="s" value="${s}"/>
      <button type="submit">Скинути до MAX</button>
      <a class="btn secondary" href="${linkSelf("/admin/energy/html", "&_="+Date.now())}">Оновити</a>
    </form>

    <div style="margin-top:14px">
      <a class="btn secondary" href="/admin/checklist/html?s=${encodeURIComponent(s)}">← Повернутись до Checklist</a>
    </div>
  </div>
</body>
</html>`;
}

export async function handleAdminEnergy(req, env, url) {
  try {
    if (!requireSecret(env, url)) return unauthorized();

    const p = url.pathname;

    // JSON: поточний стан
    if (p === "/admin/energy" && req.method === "GET") {
      const u = pickUserId(env, url);
      if (!u) return json({ ok: false, error: "user_id_required" }, { status: 400 });
      const energy = await getEnergy(env, u);
      const max = Number(env.ENERGY_MAX || 100);
      const low = Number(env.ENERGY_LOW_THRESHOLD || 10);
      const recoverPerMin = Number(env.ENERGY_RECOVER_PER_MIN || 1);
      return json({ ok: true, userId: u, energy, max, low, recoverPerMin });
    }

    // HTML: перегляд
    if (p === "/admin/energy/html" && req.method === "GET") {
      const u = pickUserId(env, url);
      const energy = await getEnergy(env, u);
      const max = Number(env.ENERGY_MAX || 100);
      const low = Number(env.ENERGY_LOW_THRESHOLD || 10);
      const recoverPerMin = Number(env.ENERGY_RECOVER_PER_MIN || 1);
      return new Response(
        htmlPage({ s: url.searchParams.get("s") || "", u, energy, max, low, recoverPerMin }),
        CTYPE_HTML
      );
    }

    // POST reset
    if (p === "/admin/energy/reset" && req.method === "POST") {
      let u = "";
      const ct = req.headers.get("content-type") || "";
      if (ct.includes("application/x-www-form-urlencoded")) {
        const f = await req.formData();
        u = String(f.get("u") || "").trim();
      } else if (ct.includes("application/json")) {
        const b = await req.json().catch(() => ({}));
        u = String(b.u || "").trim();
      }
      if (!u) u = env.TELEGRAM_ADMIN_ID || "";
      if (!u) return json({ ok: false, error: "user_id_required" }, { status: 400 });
      const val = await resetEnergy(env, u);
      return json({ ok: true, userId: u, energy: val });
    }

    return notFound();
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
