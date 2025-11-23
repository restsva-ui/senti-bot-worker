// src/routes/adminEnergy.js
// Адмін-ендпоїнти енергії + мобільний HTML
import { json, html } from "../utils/http.js";

const MAX = (env) => Number(env.ENERGY_MAX ?? 100);
const LOW = (env) => Number(env.ENERGY_LOW_THRESHOLD ?? 10);
const REC = (env) => Number(env.ENERGY_RECOVER_PER_MIN ?? 1);

// Ключі в KV
const energyKey = (uid) => `energy:${uid}:state`;
const logKey = (uid, ts) => `energy:${uid}:log:${ts}`;

// Читання/запис стану
async function readState(env, uid) {
  const raw = await env.STATE_KV.get(energyKey(uid));
  if (!raw) {
    return { e: MAX(env), ts: Date.now() }; // новий користувач — повна енергія
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { e: MAX(env), ts: Date.now() };
  }
}
async function writeState(env, uid, st) {
  await env.STATE_KV.put(energyKey(uid), JSON.stringify(st));
}

async function appendLog(env, uid, item) {
  if (!env.ENERGY_LOG_KV) return;
  const ts = item.ts || Date.now();
  await env.ENERGY_LOG_KV.put(logKey(uid, ts), JSON.stringify(item), {
    expirationTtl: 60 * 60 * 24 * 30, // 30д
  });
}

// Автовідновлення: додаємо (минут * REC), але не вище MAX
function applyAutoRecover(env, st) {
  const now = Date.now();
  const mins = Math.max(0, Math.floor((now - (st.ts || now)) / 60000));
  if (mins <= 0) return st;

  const add = mins * REC(env);
  const next = Math.min(MAX(env), (st.e || 0) + add);
  if (next !== st.e) {
    st = { e: next, ts: now };
  } else {
    st.ts = now;
  }
  return { st, mins, delta: next - (st.e || 0) };
}

function guard(env, url) {
  const s = url.searchParams.get("s");
  if (env.WEBHOOK_SECRET && s !== env.WEBHOOK_SECRET) {
    return { ok: false, status: 401, err: "unauthorized" };
  }
  const u = url.searchParams.get("u");
  if (!u) return { ok: false, status: 400, err: "missing u" };
  return { ok: true, u };
}

// ── HTML (адаптивний) ────────────────────────────────────────────────────────
function energyHtml(env, userId) {
  const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
  const base = `/admin/energy`;
  const q = `?s=${s}&u=${encodeURIComponent(userId)}`;

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>Energy · ${userId}</title>
<style>
  :root{
    --bg:#0b0b0b; --fg:#e7e7e7; --muted:#9aa0a6; --card:#121212; --acc:#7dd3fc;
    --pad:14px; --radius:16px; --shadow:0 6px 24px rgba(0,0,0,.25);
  }
  @media (prefers-color-scheme: light){
    :root{ --bg:#f7f7f8; --fg:#111; --muted:#666; --card:#fff; --acc:#0ea5e9; }
  }
  *{ box-sizing:border-box }
  body{
    margin:0; background:var(--bg); color:var(--fg);
    font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans",Ubuntu,"Helvetica Neue",Arial,sans-serif;
  }
  .wrap{ max-width:880px; margin:0 auto; padding:clamp(12px,2.5vw,24px); }
  .card{
    background:var(--card); border-radius:var(--radius); box-shadow:var(--shadow);
    padding:clamp(14px,2.5vw,20px);
  }
  h1{ font-size:clamp(18px,4.5vw,22px); margin:0 0 10px; display:flex; gap:8px; align-items:center }
  .bolt{ font-size:1.2em }
  .row{ display:grid; grid-template-columns: 1fr auto; gap:10px; align-items:center; margin:10px 0; }
  .val{
    background:#00000020; border:1px solid #ffffff1a; border-radius:12px; padding:12px 14px; min-height:44px;
    display:flex; align-items:center; justify-content:flex-end; font-weight:600;
  }
  .lab{ color:var(--muted); font-weight:500; }
  .actions{ display:flex; flex-wrap:wrap; gap:10px; margin-top:16px }
  button, .btn{
    -webkit-tap-highlight-color: transparent;
    appearance:none; border:0; border-radius:12px; min-height:44px;
    padding:10px 14px; font-weight:600; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; justify-content:center;
  }
  .btn-primary{ background:#000; color:#fff }
  .btn-ghost{ background:#ffffff14; color:var(--fg) }
  .btn-muted{ background:#ffffff0a; color:var(--muted) }
  .thin{ font-variant-numeric: tabular-nums; }
  .sub{ color:var(--muted); font-size:13px; margin-top:6px }
  .grid-2{ display:grid; grid-template-columns:1fr 1fr; gap:10px }
  @media (max-width:560px){
    .row{ grid-template-columns:1fr; }
    .grid-2{ grid-template-columns:1fr; }
  }
  hr{ border:0; height:1px; background:#ffffff12; margin:16px 0 }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1><span class="bolt">⚡</span>Energy <span class="sub">(user: ${userId})</span></h1>

      <div class="row">
        <div class="lab">Поточна енергія</div>
        <div id="energy" class="val thin">…</div>
      </div>
      <div class="row">
        <div class="lab">Поріг low-mode</div>
        <div id="low" class="val thin">…</div>
      </div>
      <div class="row">
        <div class="lab">Відновлення/хв</div>
        <div id="rec" class="val thin">…</div>
      </div>

      <div class="actions grid-2">
        <a class="btn btn-primary" href="${base}/reset${q}">Скинути до MAX</a>
        <button class="btn btn-ghost" id="refresh">Оновити</button>
      </div>

      <div class="actions">
        <a class="btn btn-ghost" href="${base}/logs${q}&limit=50">Показати логи</a>
        <a class="btn btn-ghost" href="${base}/stats${q}&days=7">Показати статистику (7 днів)</a>
      </div>

      <hr />
      <a class="btn btn-muted" href="/admin/checklist/html?s=${s}">← Повернутись до Checklist</a>
    </div>
  </div>

<script>
  async function load(){
    try{
      const r = await fetch("${base}${q}");
      const d = await r.json();
      if(!d.ok) throw new Error("bad response");
      document.getElementById("energy").textContent = (d.energy ?? 0) + " / " + (d.max ?? 0);
      document.getElementById("low").textContent = d.low ?? 0;
      document.getElementById("rec").textContent = d.recoverPerMin ?? 0;
    }catch(e){
      document.getElementById("energy").textContent = "—";
      document.getElementById("low").textContent = "—";
      document.getElementById("rec").textContent = "—";
    }
  }
  document.getElementById("refresh").addEventListener("click", load);
  load();
</script>
</body>
</html>`;
}

// ── Router ───────────────────────────────────────────────────────────────────
export async function handleAdminEnergy(req, env, url) {
  const p = url.pathname || "";
  if (!p.startsWith("/admin/energy")) return null;

  const g = guard(env, url);
  if (!g.ok) return json({ ok: false, error: g.err }, g.status);

  // HTML
  if (p === "/admin/energy/html") {
    return html(energyHtml(env, g.u));
  }

  // JSON endpoints
  if (p === "/admin/energy") {
    // авто-відновлення
    let st = await readState(env, g.u);
    const before = st.e;
    const { st: upd, mins } = applyAutoRecover(env, st);
    st = upd;
    if (st.e !== before && mins > 0) {
      await appendLog(env, g.u, { ts: Date.now(), kind: "recover", delta: st.e - before, meta: { mins } });
      await writeState(env, g.u, st);
    }
    return json({
      ok: true,
      userId: String(g.u),
      energy: st.e,
      max: MAX(env),
      low: LOW(env),
      recoverPerMin: REC(env),
    });
  }

  if (p === "/admin/energy/reset") {
    const st = { e: MAX(env), ts: Date.now() };
    await writeState(env, g.u, st);
    await appendLog(env, g.u, { ts: Date.now(), kind: "reset", delta: MAX(env), meta: {} });
    // редірект назад на html для зручності з мобільного
    const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
    return Response.redirect(`/admin/energy/html?s=${s}&u=${encodeURIComponent(g.u)}`, 302);
  }

  if (p === "/admin/energy/logs") {
    if (!env.ENERGY_LOG_KV) return json({ ok: true, logs: [] });
    const limit = Math.min(200, Number(url.searchParams.get("limit") || 50));
    const prefix = `energy:${g.u}:log:`;
    const list = await env.ENERGY_LOG_KV.list({ prefix, limit });
    // нові зверху
    const items = (list.keys || []).sort((a,b) => b.name.localeCompare(a.name));
    const out = [];
    for (const k of items) {
      const raw = await env.ENERGY_LOG_KV.get(k.name);
      if (raw) out.push(JSON.parse(raw));
    }
    return json({ ok: true, userId: String(g.u), logs: out });
  }

  if (p === "/admin/energy/stats") {
    if (!env.ENERGY_LOG_KV) return json({ ok: true, days: 0, stats: [] });
    const days = Math.max(1, Math.min(30, Number(url.searchParams.get("days") || 7)));
    const now = Date.now();
    const stats = [];
    for (let i = 0; i < days; i++) {
      const dayStart = new Date(new Date(now - i*86400000).toISOString().slice(0,10)).getTime();
      const dayEnd = dayStart + 86400000;
      const prefix = `energy:${g.u}:log:`;
      const list = await env.ENERGY_LOG_KV.list({ prefix, limit: 1000 });
      let spent = 0, gained = 0, resets = 0, lastTs = 0, events = 0;
      for (const k of list.keys) {
        const ts = Number(k.name.split(":").pop());
        if (ts >= dayStart && ts < dayEnd) {
          const raw = await env.ENERGY_LOG_KV.get(k.name);
          if (!raw) continue;
          const it = JSON.parse(raw);
          events++;
          lastTs = Math.max(lastTs, ts);
          if (it.kind === "spend") spent += Math.abs(Number(it.delta||0));
          if (it.kind === "recover") gained += Math.max(0, Number(it.delta||0));
          if (it.kind === "reset") resets++;
        }
      }
      stats.unshift({
        day: new Date(dayStart).toISOString().slice(0,10),
        spent, gained, resets, events, lastTs
      });
    }
    return json({ ok: true, userId: String(g.u), days, stats });
  }

  return json({ ok: true, note: "admin energy fallback" });
}