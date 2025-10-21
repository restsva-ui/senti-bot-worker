// src/routes/adminEnergy.js
// Mobile-first HTML віджет енергії (READ-ONLY UI).
// URL: /admin/energy/html?s=<WEBHOOK_SECRET>&u=<telegram_user_id>
//
// Покладається на: ../lib/energy.js -> getEnergy(env, userId)
// Якщо параметр u не задано — використовує TELEGRAM_ADMIN_ID.

import { getEnergy } from "../lib/energy.js";

const CTYPE_HTML = { headers: { "content-type": "text/html; charset=utf-8" } };

const okHtml = (s) => new Response(String(s || ""), CTYPE_HTML);
const json = (d, init = {}) =>
  new Response(JSON.stringify(d, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8" },
    ...init,
  });

function unauthorized() {
  return json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function css() {
  return `
  <style>
    :root{color-scheme:dark}
    *{box-sizing:border-box}
    body{margin:0;background:#0b0f14;color:#e6edf3;font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial,sans-serif}
    a{color:#8ab4f8;text-decoration:none}
    a:hover{text-decoration:underline}
    .wrap{max-width:900px;margin:0 auto;padding:12px}
    .row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .card{background:#11161d;border:1px solid #1f2937;border-radius:12px;padding:14px;margin:10px 0}
    .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3;text-decoration:none}
    .btn:hover{background:#2a3f55}
    .muted{opacity:.8}
    .mono{font-family:ui-monospace,Consolas,Menlo,monospace}
    .kvs{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media (max-width:760px){ .wrap{padding:10px} .kvs{grid-template-columns:1fr} }

    .meter{width:100%;height:14px;background:#0b1117;border:1px solid #1f2937;border-radius:999px;overflow:hidden}
    .meter > span{display:block;height:100%;background:#2d8cff;transition:width .3s ease}
    .pill{display:inline-block;padding:2px 8px;border:1px solid #2d4f6b;border-radius:999px;margin-right:6px;font-size:12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    @media (max-width:640px){ .grid{grid-template-columns:1fr} }
    .kv{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
    .warn{color:#ffb454}
    .ok{color:#6ee7a8}
  </style>`;
}

function clampNum(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function progressBar(current, max) {
  const cur = clampNum(current, 0, Infinity);
  const mx = Math.max(1, Number(max || 1));
  const pct = clampNum(Math.round((cur / mx) * 100), 0, 100);
  return `
    <div class="meter" title="${cur}/${mx}">
      <span style="width:${pct}%"></span>
    </div>
    <div class="muted mono" style="margin-top:6px">${cur} / ${mx} (${pct}%)</div>
  `;
}

function etaToFull(current, max, recoverPerMin) {
  const cur = clampNum(current, 0, Infinity);
  const mx = Math.max(1, Number(max || 1));
  const r = Math.max(0, Number(recoverPerMin || 0));
  if (cur >= mx || r <= 0) return "—";
  const mins = Math.ceil((mx - cur) / r);
  if (mins < 60) return `${mins} хв`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} год ${m} хв`;
}

export async function handleAdminEnergy(req, env, url) {
  // Авторизація секретом (дубль-перевірка, але не завадить; якщо секрет у env порожній — пропускаємо)
  const secret = url.searchParams.get("s") || "";
  const expected = env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || "";
  if (expected && secret !== expected) return unauthorized();

  // Кого показуємо
  const userId = (url.searchParams.get("u") || env.TELEGRAM_ADMIN_ID || "").trim() || "admin";

  // Читаємо енергію
  let e = {};
  try {
    e = await getEnergy(env, userId);
  } catch {
    e = {};
  }

  // Формуємо значення з ENV як дефолти (на випадок якщо getEnergy не повернув усе)
  const max = Number(e.max ?? env.ENERGY_MAX ?? 100);
  const energy = Number(e.energy ?? max);
  const low = Number(e.low ?? env.ENERGY_LOW_THRESHOLD ?? 10);
  const recover = Number(e.recoverPerMin ?? env.ENERGY_RECOVER_PER_MIN ?? 1);
  const costText = Number(e.costText ?? env.ENERGY_COST_TEXT ?? 1);
  const costImage = Number(e.costImage ?? env.ENERGY_COST_IMAGE ?? 5);

  const isLow = energy <= low;
  const eta = etaToFull(energy, max, recover);

  const header = `
    <!doctype html>
    <html lang="uk">
    <head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <title>Energy • ${esc(String(userId))}</title>
      ${css()}
    </head>
    <body>
      <div class="wrap">
        <div class="card row">
          <h2 style="margin:0">⚡ Енергія</h2>
          <div class="row" style="gap:8px">
            <a class="btn" href="/admin/energy/html?s=${encodeURIComponent(secret)}&u=${encodeURIComponent(userId)}">Оновити</a>
          </div>
        </div>
  `;

  const balance = `
    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <div class="kv">
          <span class="pill mono">u=${esc(String(userId))}</span>
          <span class="pill mono">tz=${esc(String(env.TIMEZONE || "UTC"))}</span>
        </div>
        <div class="kv">
          <span class="muted mono">DEPLOY=${esc(String(env.DEPLOY_ID || "n/a"))}</span>
        </div>
      </div>

      <b>Поточний баланс</b>
      <div style="margin:8px 0 10px">${progressBar(energy, max)}</div>

      <div class="grid">
        <div class="card" style="margin:0">
          <div class="muted">Налаштування</div>
          <div style="margin-top:8px" class="mono">
            MAX = ${max}<br/>
            LOW = ${low} ${isLow ? '<span class="warn">(низько)</span>' : '<span class="ok">(ок)</span>'}<br/>
            RECOVER_PER_MIN = ${recover}<br/>
            ETA до повного = ${esc(eta)}
          </div>
        </div>
        <div class="card" style="margin:0">
          <div class="muted">Вартість дій</div>
          <div style="margin-top:8px" class="mono">
            costText = ${costText}<br/>
            costImage = ${costImage}
          </div>
        </div>
      </div>

      <p class="muted" style="margin-top:12px">
        * Ця сторінка тільки відображає стан. Зміни балансу відбуваються автоматично через бота (списання/відновлення) або службові задачі.
      </p>
    </div>
  `;

  const tech = `
    <div class="card">
      <b>Технічні деталі</b>
      <div class="grid" style="margin-top:8px">
        <div class="card" style="margin:0">
          <div class="muted">ENV (витяги)</div>
          <div class="mono" style="margin-top:6px;white-space:pre-wrap">
ENERGY_MAX=${esc(String(env.ENERGY_MAX ?? ""))}
ENERGY_RECOVER_PER_MIN=${esc(String(env.ENERGY_RECOVER_PER_MIN ?? ""))}
ENERGY_COST_TEXT=${esc(String(env.ENERGY_COST_TEXT ?? ""))}
ENERGY_COST_IMAGE=${esc(String(env.ENERGY_COST_IMAGE ?? ""))}
ENERGY_LOW_THRESHOLD=${esc(String(env.ENERGY_LOW_THRESHOLD ?? ""))}
          </div>
        </div>
        <div class="card" style="margin:0">
          <div class="muted">getEnergy() raw</div>
          <pre class="mono" style="margin-top:6px">${esc(JSON.stringify(e || {}, null, 2))}</pre>
        </div>
      </div>
    </div>
  `;

  const footer = `
      </div>
    </body>
    </html>
  `;

  return okHtml(header + balance + tech + footer);
}