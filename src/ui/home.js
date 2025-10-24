// src/ui/home.js
import { abs } from "../utils/url.js";

export function home(env) {
  const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
  const link  = (path) => abs(env, path);
  const linkS = (path) => abs(env, `${path}${path.includes("?") ? "&" : "?"}s=${s}`);

  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Senti Worker</title>
<style>
  :root { color-scheme: light dark }
  body{
    margin:16px;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, sans-serif;
    line-height:1.35;
    background: Canvas; color: CanvasText;
  }
  header{display:flex; align-items:center; gap:8px; margin-bottom:6px}
  header h1{font-size:20px; margin:0}
  header small{opacity:.7}
  .note{font-size:12px; opacity:.8; margin:4px 0 14px}
  .grid{
    display:grid; gap:10px;
    grid-template-columns: repeat(2, minmax(0,1fr));
  }
  @media (min-width: 720px){ .grid{ grid-template-columns: repeat(3, minmax(0,1fr)); } }
  a.btn{
    position:relative;
    display:flex; align-items:center; gap:10px;
    min-height:56px; padding:12px 14px; border-radius:14px;
    text-decoration:none; color:inherit;
    background: color-mix(in oklab, Canvas 96%, CanvasText 6%);
    border:1px solid color-mix(in oklab, CanvasText 20%, Canvas 80%);
    box-shadow: 0 1px 0 color-mix(in oklab, CanvasText 12%, Canvas 88%) inset;
  }
  a.btn:active{ transform: translateY(1px); }
  .ico{font-size:22px; width:28px; text-align:center}
  .ttl{font-weight:600}
  .sub{font-size:12px; opacity:.75}
  .dot{
    position:absolute; top:8px; right:8px;
    width:10px; height:10px; border-radius:50%;
    background: color-mix(in oklab, CanvasText 35%, Canvas 65%);
    box-shadow: 0 0 0 2px color-mix(in oklab, Canvas 92%, CanvasText 8%) inset;
  }
  .dot.loading{ animation: pulse 1s infinite ease-in-out; }
  .dot.ok{ background: #22c55e; }
  .dot.fail{ background: #ef4444; }
  .code{
    position:absolute; bottom:8px; right:10px; font-size:11px; opacity:.65;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  }
  @keyframes pulse { 0%,100%{ opacity:.55 } 50%{ opacity:1 } }
</style>

<header>
  <div class="ico">⚙️</div>
  <h1>Senti Worker Active</h1>
</header>
<p class="note"><small>Service: ${env.SERVICE_HOST || ""}</small></p>
<p class="note">${env.WEBHOOK_SECRET ? "✅ Webhook secret застосовано — внутрішні перевірки будуть авторизовані." : "⚠️ Не задано WEBHOOK_SECRET — деякі перевірки можуть повертати 401/404."}</p>

<div class="grid">

  <a class="btn" id="btn-health" data-ping="${linkS("/health")}" href="${link("/health")}">
    <span class="dot loading"></span><span class="code"></span>
    <div class="ico">✅</div><div><div class="ttl">Health</div><div class="sub">Ping сервісу</div></div>
  </a>

  <a class="btn" id="btn-webhook" data-ping="${linkS("/webhook")}" href="${link("/webhook")}">
    <span class="dot loading"></span><span class="code"></span>
    <div class="ico">📡</div><div><div class="ttl">Webhook</div><div class="sub">GET alive</div></div>
  </a>

  <a class="btn" id="btn-selftest" data-ping="${linkS("/selftest/run")}" href="${linkS("/selftest/run")}">
    <span class="dot loading"></span><span class="code"></span>
    <div class="ico">🧪</div><div><div class="ttl">SelfTest</div><div class="sub">Швидка перевірка</div></div>
  </a>

  <a class="btn" id="btn-checklist" data-ping="${linkS("/admin/checklist/html")}" href="${linkS("/admin/checklist/html")}">
    <span class="dot loading"></span><span class="code"></span>
    <div class="ico">📋</div><div><div class="ttl">Checklist</div><div class="sub">HTML редактор</div></div>
  </a>

  <a class="btn" id="btn-repo" data-ping="${linkS("/admin/repo/html")}" href="${linkS("/admin/repo/html")}">
    <span class="dot loading"></span><span class="code"></span>
    <div class="ico">📚</div><div><div class="ttl">Repo / Архів</div><div class="sub">поточний та історія</div></div>
  </a>

  <a class="btn" id="btn-statut" data-ping="${linkS("/admin/statut/html")}" href="${linkS("/admin/statut/html")}">
    <span class="dot loading"></span><span class="code"></span>
    <div class="ico">📜</div><div><div class="ttl">Statut</div><div class="sub">правила / систем підказ</div></div>
  </a>

  <a class="btn" id="btn-brain-current" data-ping="${linkS("/api/brain/current")}" href="${link("/api/brain/current")}">
    <span class="dot loading"></span><span class="code"></span>
    <div class="ico">🧠</div><div><div class="ttl">Brain: current</div><div class="sub">активний архів</div></div>
  </a>

  <a class="btn" id="btn-brain-list" data-ping="${linkS("/api/brain/list")}" href="${linkS("/api/brain/list")}">
    <span class="dot loading"></span><span class="code"></span>
    <div class="ico">🗂️</div><div><div class="ttl">Brain: list</div><div class="sub">всі архіви</div></div>
  </a>

  <a class="btn" id="btn-brain-state" data-ping="${linkS("/brain/state")}" href="${link("/brain/state")}">
    <span class="dot loading"></span><span class="code"></span>
    <div class="ico">🧩</div><div><div class="ttl">Brain state</div><div class="sub">JSON стан</div></div>
  </a>

  <a class="btn" id="btn-train-analyze" href="${linkS("/ai/train/analyze")}">
    <div class="ico">🤖</div><div><div class="ttl">AI-Train: Analyze</div><div class="sub">розбір діалогів</div></div>
  </a>

  <a class="btn" id="btn-train-auto" href="${linkS("/ai/train/auto")}">
    <div class="ico">⚙️</div><div><div class="ttl">AI-Train: Auto</div><div class="sub">авто-promote</div></div>
  </a>

  <a class="btn" id="btn-evolve-run" href="${linkS("/ai/evolve/run")}">
    <div class="ico">🔁</div><div><div class="ttl">AI-Evolve</div><div class="sub">порівняння версій</div></div>
  </a>

  <a class="btn" id="btn-evolve-auto" href="${linkS("/ai/evolve/auto")}">
    <div class="ico">🚀</div><div><div class="ttl">AI-Evolve Auto</div><div class="sub">selftest + promote</div></div>
  </a>

</div>

<script>
  async function ping(url){
    try{
      const r = await fetch(url, { method:"GET" });
      return { ok:r.ok, status:r.status };
    }catch{
      return { ok:false, status:0 };
    }
  }
  async function boot(){
    const tiles = Array.from(document.querySelectorAll('a.btn[data-ping]'));
    await Promise.all(tiles.map(async (el)=>{
      const dot = el.querySelector('.dot');
      const code = el.querySelector('.code');
      const url = el.getAttribute('data-ping');
      const { ok, status } = await ping(url);
      dot.classList.remove('loading');
      dot.classList.add(ok ? 'ok' : 'fail');
      if (code) code.textContent = status ? status : "ERR";
    }));
  }
  addEventListener('load', boot, { once:true });
</script>
`;
}