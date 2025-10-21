// src/routes/adminEnergy.js
import { getEnergy, setEnergyCosts } from "../lib/energy.js";

const CTYPE_HTML = { headers: { "content-type": "text/html; charset=utf-8" } };
const okHtml = (s) => new Response(s, CTYPE_HTML);
const json = (d, init={}) => new Response(JSON.stringify(d, null, 2), {
  headers: { "content-type": "application/json; charset=utf-8" }, ...init
});

export async function handleAdminEnergy(req, env, url) {
  // Публічна HTML-сторінка (як у 1.8) — без секрету
  if (req.method === "GET" && url.pathname === "/admin/energy/html") {
    const s = await getEnergy(env, url.searchParams.get("u") || env.TELEGRAM_ADMIN_ID);
    const css = `
      <style>
        :root{--bg:#0b0f14;--panel:#11161d;--border:#1f2937;--txt:#e6edf3;--muted:#9aa7b2}
        body{margin:0;background:var(--bg);color:var(--txt);font-family:system-ui,Segoe UI,Roboto,sans-serif}
        .wrap{max-width:980px;margin:0 auto;padding:12px}
        .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px}
        .row{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
        .muted{color:var(--muted)}
        @media(max-width:840px){.wrap{padding:10px}}
      </style>`;
    const html = `
      ${css}
      <div class="wrap">
        <div class="card">
          <div class="row" style="justify-content:space-between">
            <b>⚡ Energy</b><span class="muted">Мобільний вигляд</span>
          </div>
          <div class="row" style="gap:24px;margin-top:6px">
            <div><div class="muted">User</div><div>${String(s.userId || "")}</div></div>
            <div><div class="muted">Balance</div><div>${String(s.balance ?? 0)}</div></div>
            <div><div class="muted">Cost (text)</div><div>${String(s.costText ?? 1)}</div></div>
            <div><div class="muted">Cost (image)</div><div>${String(s.costImage ?? 5)}</div></div>
          </div>
          <div class="muted" style="margin-top:8px">Поповнення/налаштування — через API/адмін-інтерфейси.</div>
        </div>
      </div>`;
    return okHtml(html);
  }

  // API (захищено секретом)
  if (req.method === "POST" && url.pathname === "/admin/energy/set-costs") {
    const secret = url.searchParams.get("s") || "";
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return json({ ok:false, error:"unauthorized" }, { status:401 });
    }
    const body = await req.json().catch(()=> ({}));
    const out = await setEnergyCosts(env, Number(body.text) || 1, Number(body.image) || 5);
    return json({ ok: !!out?.ok });
  }

  return null;
}