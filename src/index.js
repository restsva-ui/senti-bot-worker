// src/index.js
import { TG } from "./lib/tg.js";
import { getUserTokens, putUserTokens } from "./lib/userDrive.js";

import {
  readChecklist, writeChecklist, appendChecklist, checklistHtml,
  saveArchive, listArchives, getArchive, deleteArchive,
  readStatut, writeStatut, statutHtml
} from "./lib/kvChecklist.js";
import { logHeartbeat } from "./lib/audit.js";

// ---------- utils ----------
import { abs } from "./utils/url.js";

// ---------- modular routes ----------
import { handleAdminRepo }       from "./routes/adminRepo.js";
import { handleAdminChecklist }  from "./routes/adminChecklist.js";
import { handleAdminStatut }     from "./routes/adminStatut.js";
import { handleAdminBrain }      from "./routes/adminBrain.js";
import { handleTelegramWebhook } from "./routes/webhook.js";
import { handleHealth }          from "./routes/health.js";
import { handleBrainState }      from "./routes/brainState.js";
import { handleCiDeploy }        from "./routes/ciDeploy.js";
import { handleBrainApi }        from "./routes/brainApi.js";
import { handleSelfTest }        from "./routes/selfTest.js";
import { handleAiTrain }         from "./routes/aiTrain.js";
import { handleAiEvolve }        from "./routes/aiEvolve.js"; // ⬅ новий модуль
import { handleBrainPromote }    from "./routes/brainPromote.js"; // ⬅ промоут архіву

// ---------- helpers ----------
const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);
const html = (s)=> new Response(s, { headers:{ "content-type":"text/html; charset=utf-8" }});
const json = (o, status=200)=> new Response(JSON.stringify(o, null, 2), { status, headers:{ "content-type":"application/json" }});

// (залишаємо на майбутнє)
const needSecret = (env, url) => {
  const path = url.pathname || "";
  if (path.startsWith("/selftest")) return false;
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") === env.WEBHOOK_SECRET) return false;
  return !!env.WEBHOOK_SECRET;
};

// ---------- small UI for root (mobile-first) ----------
function home(env) {
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

// ---------- HTTP worker ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // 🔧 НОРМАЛІЗАЦІЯ ШЛЯХУ: зрізаємо кінцеві слеші
    const p = (url.pathname || "/").replace(/\/+$/,"") || "/";
    url.pathname = p; // ⬅ важливо: щоб усі handle* бачили вже нормалізований шлях

    try {
      // ---- health ----
      if (p === "/" || p === "/health") {
        const r = await handleHealth?.(req, env, url);
        if (r) return r;
        if (p === "/") return html(home(env));
        return json({ ok:true, service: env.SERVICE_HOST });
      }

      // ---- Brain state ----
      if (p === "/brain/state") {
        const r = await handleBrainState(req, env, url);
        if (r) return r;
      }

      // ---- Brain Promote (перед загальним /api/brain*) ----
      if (p.startsWith("/api/brain/promote")) {
        const r = await handleBrainPromote(req, env, url);
        if (r) return r;
      }

      // ---- Brain API ----
      if (p.startsWith("/api/brain")) {
        const r = await handleBrainApi(req, env, url);
        if (r) return r;
      }

      // ---- SelfTest ----
      if (p.startsWith("/selftest")) {
        const r = await handleSelfTest(req, env, url);
        if (r) return r;
      }

      // ---- AI-Train ----
      if (p.startsWith("/ai/train")) {
        const r = await handleAiTrain(req, env, url);
        if (r) return r;
      }

      // ---- AI-Evolve ----
      if (p.startsWith("/ai/evolve")) {
        const r = await handleAiEvolve(req, env, url);
        if (r) return r;
      }

      // ---- Admin modules ----
      if (p.startsWith("/admin/checklist")) {
        const r = await handleAdminChecklist(req, env, url);
        if (r) return r;
      }
      if (p.startsWith("/admin/repo") || p.startsWith("/admin/archive")) {
        const r = await handleAdminRepo(req, env, url);
        if (r) return r;
      }
      if (p.startsWith("/admin/statut")) {
        const r = await handleAdminStatut(req, env, url);
        if (r) return r;
      }
      if (p.startsWith("/admin/brain")) {
        const r = await handleAdminBrain(req, env, url);
        if (r) return r;
      }

      // ---- Telegram webhook ----
      if (p === "/webhook") {
        // Легка відповідь на GET (для selftest і плитки)
        if (req.method === "GET") {
          return json({ ok: true, method: "GET", message: "webhook alive" });
        }
        if (req.method === "POST") {
          const sec = req.headers.get("x-telegram-bot-api-secret-token");
          if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
            return json({ ok:false, error:"unauthorized" }, 401);
          }
        }
        const r = await handleTelegramWebhook(req, env, url);
        if (r) return r;
      }

      // ---- Telegram helpers ----
      if (p === "/tg/get-webhook") {
        const r = await TG.getWebhook(env.BOT_TOKEN);
        return new Response(await r.text(), { headers:{ "content-type":"application/json" } });
      }
      if (p === "/tg/set-webhook") {
        const target = abs(env, "/webhook");
        const r = await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
        return new Response(await r.text(), { headers:{ "content-type":"application/json" } });
      }
      if (p === "/tg/del-webhook") {
        const r = await TG.deleteWebhook?.(env.BOT_TOKEN)
              || await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook`);
        return new Response(await r.text(), { headers:{ "content-type":"application/json" } });
      }

      // ---- CI deploy ----
      if (p.startsWith("/ci/deploy-note")) {
        const r = await handleCiDeploy(req, env, url);
        if (r) return r;
      }

      // ---- OAuth Google ----
      if (p === "/auth/start") {
        const u = url.searchParams.get("u");
        const state = btoa(JSON.stringify({ u }));
        const redirect_uri = abs(env, "/auth/cb");
        const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
        auth.searchParams.set("redirect_uri", redirect_uri);
        auth.searchParams.set("response_type", "code");
        auth.searchParams.set("access_type", "offline");
        auth.searchParams.set("prompt", "consent");
        auth.searchParams.set("scope", "https://www.googleapis.com/auth/drive.file");
        auth.searchParams.set("state", state);
        return Response.redirect(auth.toString(), 302);
      }

      if (p === "/auth/cb") {
        const state = JSON.parse(atob(url.searchParams.get("state") || "e30="));
        const code = url.searchParams.get("code");
        const redirect_uri = abs(env, "/auth/cb");
        const body = new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri,
          grant_type: "authorization_code",
        });
        const r = await fetch("https://oauth2.googleapis.com/token", {
          method:"POST",
          headers:{ "Content-Type":"application/x-www-form-urlencoded" },
          body
        });
        const d = await r.json();
        if (!r.ok) return html(`<pre>${JSON.stringify(d, null, 2)}</pre>`);
        const tokens = {
          access_token: d.access_token,
          refresh_token: d.refresh_token,
          expiry: Math.floor(Date.now()/1000) + (d.expires_in || 3600) - 60,
        };
        await putUserTokens(env, state.u, tokens);
        return html(`<h3>✅ Готово</h3><p>Тепер повернись у Telegram і натисни <b>Google Drive</b> ще раз.</p>`);
      }

      // ---- fallback health (перед 404) ----
      if (p === "/health") {
        const r = await handleHealth?.(req, env, url);
        if (r) return r;
      }

      // ---- not found ----
      return json({ ok:false, error:"Not found" }, 404);

    } catch (e) {
      return json({ ok:false, error:String(e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // стандартний heartbeat лог
    await logHeartbeat(env);

    // Щогодинний автозапуск AI-Evolve Auto (кроном "0 * * * *")
    try {
      if (event && event.cron === "0 * * * *") {
        const u = new URL(abs(env, "/ai/evolve/auto"));
        if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);
        const req = new Request(u.toString(), { method: "GET" });
        await handleAiEvolve(req, env, u);
      }
    } catch (e) {
      await appendChecklist(env, `[${new Date().toISOString()}] evolve_auto:error ${String(e)}`);
    }
  }
};