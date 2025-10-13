// [3/3] src/routes/adminEnergy.js
import { html, json } from "../utils/http.js";
import { getEnergy, resetEnergy, spendEnergy } from "../lib/energy.js";
import { getEnergyLogs, getEnergyStats } from "../lib/energyLog.js";

const okAuth = (env, url) =>
  !env.WEBHOOK_SECRET || url.searchParams.get("s") === env.WEBHOOK_SECRET;

const uid = (env, url) =>
  url.searchParams.get("u") || String(env.TELEGRAM_ADMIN_ID || "");

export async function handleAdminEnergy(req, env, url) {
  if (!okAuth(env, url)) return json({ ok: false, error: "unauthorized" }, 401);

  const u = uid(env, url);
  const p = url.pathname;

  // JSON API ---------------------------------------------------
  if (p === "/admin/energy" && req.method === "GET") {
    const st = await getEnergy(env, u);
    return json({ ok: true, userId: u, energy: st.energy, max: st.max, low: st.low, recoverPerMin: st.recoverPerMin });
  }

  if (p === "/admin/energy/reset" && req.method === "POST") {
    const st = await resetEnergy(env, u);
    return json({ ok: true, userId: u, energy: st.energy });
  }

  // витрата (адмін/тест)
  if (p === "/admin/energy/spend" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount ?? 1);
    const kind = String(body.kind ?? "spend");
    const st = await spendEnergy(env, u, amount, kind);
    return json({ ok: true, userId: u, energy: st.energy });
  }

  if (p === "/admin/energy/logs" && req.method === "GET") {
    const limit = Number(url.searchParams.get("limit") || 100);
    const logs = await getEnergyLogs(env, u, { limit });
    return json({ ok: true, userId: u, logs });
  }

  if (p === "/admin/energy/stats" && req.method === "GET") {
    const days = Number(url.searchParams.get("days") || 7);
    const stats = await getEnergyStats(env, u, { days });
    return json({ ok: true, userId: u, days, stats });
  }

  // HTML панель ------------------------------------------------
  if (p === "/admin/energy/html") {
    const s = new URL(env.SERVICE_HOST ? `https://${env.SERVICE_HOST}` : url.origin);
    s.pathname = "/admin/energy";
    s.searchParams.set("u", u);
    s.searchParams.set("s", env.WEBHOOK_SECRET || "");

    const resetUrl = new URL(s); resetUrl.pathname = "/admin/energy/reset";
    const logsUrl  = new URL(s); logsUrl.pathname  = "/admin/energy/logs";
    const statsUrl = new URL(s); statsUrl.pathname = "/admin/energy/stats";

    const st = await getEnergy(env, u);

    return html(`
<!doctype html><meta charset="utf-8"/>
<title>Energy (user: ${u})</title>
<style>
  body{background:#0b0b0b;color:#e7e7e7;font:14px/1.5 system-ui,sans-serif;margin:0;padding:18px}
  .card{background:#121212;border-radius:16px;max-width:720px;padding:20px;margin:auto;box-shadow:0 0 0 1px #222}
  h2{margin:0 0 16px} .row{display:flex;gap:12px;margin:10px 0}
  .pill{flex:1;background:#1a1a1a;border-radius:12px;padding:14px 16px}
  .val{float:right;color:#9aa0a6}
  .btn{padding:12px 16px;border-radius:12px;border:none;background:white;color:black;cursor:pointer}
  .btn.gray{background:#3a3a3a;color:#e7e7e7}
  .sub{margin-top:12px}
  pre{white-space:pre-wrap;background:#0f0f10;padding:12px;border-radius:12px;max-height:360px;overflow:auto}
</style>
<div class="card">
  <h2>⚡ Energy (user: ${u})</h2>
  <div class="row"><div class="pill">Поточна енергія <span class="val">${st.energy} / ${st.max}</span></div></div>
  <div class="row"><div class="pill">Поріг low-mode <span class="val">${st.low}</span></div></div>
  <div class="row"><div class="pill">Відновлення/хв <span class="val">${st.recoverPerMin}</span></div></div>
  <div class="row">
    <button class="btn" onclick="reset()">Скинути до MAX</button>
    <button class="btn gray" onclick="refresh()">Оновити</button>
  </div>
  <div class="row sub">
    <button class="btn gray" onclick="loadLogs()">Показати логи</button>
    <button class="btn gray" onclick="loadStats()">Показати статистику (7 днів)</button>
  </div>
  <pre id="out"></pre>
  <div class="row sub">
    <a class="btn gray" href="/admin/checklist/html?s=${encodeURIComponent(env.WEBHOOK_SECRET||"")}" style="text-decoration:none;display:inline-block">← Повернутись до Checklist</a>
  </div>
</div>
<script>
  const S = "${encodeURIComponent(env.WEBHOOK_SECRET || "")}";
  const U = "${encodeURIComponent(u)}";
  async function refresh(){
    const r = await fetch(\`${s.pathname}?s=\${S}&u=\${U}\`);
    document.getElementById('out').textContent = await r.text();
    location.reload();
  }
  async function reset(){
    const r = await fetch("${resetUrl.pathname}?s="+S+"&u="+U, {method:"POST"});
    document.getElementById('out').textContent = await r.text();
    location.reload();
  }
  async function loadLogs(){
    const r = await fetch("${logsUrl.pathname}?s="+S+"&u="+U+"&limit=50");
    document.getElementById('out').textContent = await r.text();
  }
  async function loadStats(){
    const r = await fetch("${statsUrl.pathname}?s="+S+"&u="+U+"&days=7");
    document.getElementById('out').textContent = await r.text();
  }
</script>
    `);
  }

  return json({ ok: false, error: "not found" }, 404);
}