// src/index.js
import { TG } from "./lib/tg.js";
import { putUserTokens } from "./lib/userDrive.js";
import {
  checklistHtml, listArchives, getArchive,
  statutHtml, appendChecklist
} from "./lib/kvChecklist.js";
import { logHeartbeat } from "./lib/audit.js";
import { abs } from "./utils/url.js";

// routes
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
import { handleAiEvolve }        from "./routes/aiEvolve.js";
import { handleBrainPromote }    from "./routes/brainPromote.js";

const html = (s)=> new Response(s, { headers:{ "content-type":"text/html; charset=utf-8" }});
const json = (o, status=200, h={})=> new Response(JSON.stringify(o, null, 2), {
  status, headers:{ "content-type":"application/json; charset=utf-8", ...h }
});

// ---------- small UI ----------
function home(env){
  const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
  const link  = (path) => abs(env, path);
  const linkS = (path) => abs(env, `${path}${path.includes("?") ? "&" : "?"}s=${s}`);
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Senti Worker</title>
<style>:root{color-scheme:light dark}body{margin:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,sans-serif;line-height:1.35}
.grid{display:grid;gap:10px;grid-template-columns:repeat(2,minmax(0,1fr))}@media(min-width:720px){.grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
a.btn{position:relative;display:flex;gap:10px;align-items:center;min-height:56px;padding:12px 14px;border-radius:14px;text-decoration:none;color:inherit;
background:color-mix(in oklab,Canvas 96%,CanvasText 6%);border:1px solid color-mix(in oklab,CanvasText 20%,Canvas 80%)}
.dot{position:absolute;top:8px;right:8px;width:10px;height:10px;border-radius:50%;background:color-mix(in oklab,CanvasText 35%,Canvas 65%)}
.dot.loading{animation:pulse 1s infinite}.dot.ok{background:#22c55e}.dot.fail{background:#ef4444}@keyframes pulse{0%,100%{opacity:.55}50%{opacity:1}}
.code{position:absolute;bottom:8px;right:10px;font:11px ui-monospace,monospace;opacity:.65}
</style>
<header><div>⚙️</div><h1>Senti Worker Active</h1></header>
<p><small>Service: ${env.SERVICE_HOST || ""}</small></p>
<p>${env.WEBHOOK_SECRET ? "✅ Webhook secret застосовано — внутрішні перевірки будуть авторизовані." : "⚠️ Не задано WEBHOOK_SECRET — деякі перевірки можуть повертати 401/404."}</p>
<div class="grid">
  <a class="btn" data-ping="${linkS("/health")}" href="${link("/health")}"><span class="dot loading"></span><span class="code"></span>✅ <b>Health</b></a>
  <a class="btn" data-ping="${linkS("/webhook")}" href="${link("/webhook")}"><span class="dot loading"></span><span class="code"></span>📡 <b>Webhook</b></a>
  <a class="btn" data-ping="${linkS("/selftest/run")}" href="${linkS("/selftest/run")}"><span class="dot loading"></span><span class="code"></span>🧪 <b>SelfTest</b></a>
  <a class="btn" data-ping="${linkS("/admin/checklist/html")}" href="${linkS("/admin/checklist/html")}"><span class="dot loading"></span><span class="code"></span>📋 <b>Checklist</b></a>
  <a class="btn" data-ping="${linkS("/admin/repo/html")}" href="${linkS("/admin/repo/html")}"><span class="dot loading"></span><span class="code"></span>📚 <b>Repo/Архів</b></a>
  <a class="btn" data-ping="${linkS("/admin/statut/html")}" href="${linkS("/admin/statut/html")}"><span class="dot loading"></span><span class="code"></span>📜 <b>Statut</b></a>
  <a class="btn" data-ping="${linkS("/api/brain/current")}" href="${link("/api/brain/current")}"><span class="dot loading"></span><span class="code"></span>🧠 <b>Brain: current</b></a>
  <a class="btn" data-ping="${linkS("/api/brain/list")}" href="${linkS("/api/brain/list")}"><span class="dot loading"></span><span class="code"></span>🗂️ <b>Brain: list</b></a>
  <a class="btn" data-ping="${linkS("/brain/state")}" href="${link("/brain/state")}"><span class="dot loading"></span><span class="code"></span>🧩 <b>Brain state</b></a>
  <a class="btn" href="${linkS("/ai/train/analyze")}">🤖 <b>AI-Train: Analyze</b></a>
  <a class="btn" href="${linkS("/ai/train/auto")}">⚙️ <b>AI-Train: Auto</b></a>
  <a class="btn" href="${linkS("/ai/evolve/run")}">🔁 <b>AI-Evolve</b></a>
  <a class="btn" href="${linkS("/ai/evolve/auto")}">🚀 <b>AI-Evolve Auto</b></a>
</div>
<script>
  async function ping(u){try{const r=await fetch(u);return{ok:r.ok,status:r.status}}catch{return{ok:false,status:0}}}
  addEventListener('load',async()=>{for(const el of document.querySelectorAll('[data-ping]')){const r=await ping(el.getAttribute('data-ping'));el.querySelector('.dot')?.classList.remove('loading');el.querySelector('.dot')?.classList.add(r.ok?'ok':'fail');const c=el.querySelector('.code');if(c)c.textContent=r.status||'ERR'}},{once:true});
</script>`;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // нормалізація шляху (прибираємо кінцеві слеші) і підміна для всіх handle*
    const p = (url.pathname || "/").replace(/\/+$/,"") || "/";
    url.pathname = p;

    try {
      // --- root / health / webhook (гарантовано без 404) ---
      if (p === "/") return html(home(env));

      if (p === "/health") {
        const r = await handleHealth?.(req, env, url);
        // якщо модуль раптом повернув 404 або null — даємо 200
        if (r && r.status !== 404) return r;
        return json({ ok:true, service: env.SERVICE_HOST || "worker" });
      }

      if (p === "/webhook" && req.method === "GET") {
        // легкий алів-пінг
        return json({ ok:true, method:"GET", message:"webhook alive" });
      }

      // --- brain state ---
      if (p === "/brain/state") {
        const r = await handleBrainState?.(req, env, url);
        if (r && r.status !== 404) return r;
        return json({ ok:true, state:"available" });
      }

      // --- /api/brain/promote перед загальним /api/brain ---
      if (p.startsWith("/api/brain/promote")) {
        const r = await handleBrainPromote?.(req, env, url);
        if (r) return r; // тут очікуємо 200/401/400 від модуля
        return json({ ok:false, error:"promote handler missing" }, 404);
      }

      // --- /api/brain/* ---
      if (p.startsWith("/api/brain")) {
        const r = await handleBrainApi?.(req, env, url);
        if (r) return r; // модуль уже віддає 200/401/404 як треба

        // дефолти на випадок, якщо модуль нічого не повернув
        if (p === "/api/brain/current" && req.method === "GET") {
          const cur = await env.CHECKLIST_KV.get("brain:current");
          return json({ ok:true, current:cur||null, exists:!!cur });
        }
        if (p === "/api/brain/list" && req.method === "GET") {
          const items = await listArchives(env).catch(()=>[]);
          const arr = Array.isArray(items) ? items : (items?.items || []);
          return json({ ok:true, total:arr.length, items:arr });
        }
        if (p === "/api/brain/get" && req.method === "GET") {
          const key = url.searchParams.get("key");
          if (!key) return json({ ok:false, error:"key required" }, 400);
          const b64 = await getArchive(env, key);
          if (!b64) return json({ ok:false, error:"not found" }, 404);
          const bin = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
          return new Response(bin, {
            headers:{
              "content-type":"application/zip",
              "content-disposition":`attachment; filename="${key.split("/").pop()}"`
            }
          });
        }
        return json({ ok:false, error:"unknown endpoint" }, 404);
      }

      // --- selftest ---
      if (p.startsWith("/selftest")) {
        const r = await handleSelfTest?.(req, env, url);
        if (r) return r;
        return json({ ok:false, error:"selftest handler not found" }, 404);
      }

      // --- ai ---
      if (p.startsWith("/ai/train"))  { const r = await handleAiTrain?.(req, env, url);  if (r) return r; }
      if (p.startsWith("/ai/evolve")) { const r = await handleAiEvolve?.(req, env, url); if (r) return r; }

      // --- admin (даємо дружні фолбеки замість 404) ---
      if (p.startsWith("/admin/checklist")) {
        const r = await handleAdminChecklist?.(req, env, url);
        if (r && r.status !== 404) return r;
        return html(await checklistHtml?.(env).catch(()=>"<h3>Checklist</h3>"));
      }
      if (p.startsWith("/admin/repo") || p.startsWith("/admin/archive")) {
        const r = await handleAdminRepo?.(req, env, url);
        if (r && r.status !== 404) return r;
        return html(`<h3>Repo / Архів</h3><p>Fallback UI.</p>`);
      }
      if (p.startsWith("/admin/statut")) {
        const r = await handleAdminStatut?.(req, env, url);
        if (r && r.status !== 404) return r;
        return html(await statutHtml?.(env).catch(()=>"<h3>Statut</h3>"));
      }
      if (p.startsWith("/admin/brain")) {
        const r = await handleAdminBrain?.(req, env, url);
        if (r && r.status !== 404) return r;
        return json({ ok:true, note:"admin brain fallback" });
      }

      // --- webhook POST ---
      if (p === "/webhook" && req.method === "POST") {
        const sec = req.headers.get("x-telegram-bot-api-secret-token");
        if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
          return json({ ok:false, error:"unauthorized" }, 401);
        }
        const r = await handleTelegramWebhook?.(req, env, url);
        if (r) return r;
        return json({ ok:true });
      }

      // --- tg helpers ---
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

      // --- ci deploy ---
      if (p.startsWith("/ci/deploy-note")) {
        const r = await handleCiDeploy?.(req, env, url);
        if (r) return r;
        return json({ ok:true });
      }

      // --- oauth ---
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

      // --- not found ---
      return json({ ok:false, error:"Not found" }, 404);

    } catch (e) {
      return json({ ok:false, error:String(e) }, 500);
    }
  },

  async scheduled(event, env) {
    await logHeartbeat(env);
    try {
      if (event && event.cron === "0 * * * *") {
        const u = new URL(abs(env, "/ai/evolve/auto"));
        if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);
        const req = new Request(u.toString(), { method: "GET" });
        await handleAiEvolve?.(req, env, u);
      }
    } catch (e) {
      await appendChecklist(env, `[${new Date().toISOString()}] evolve_auto:error ${String(e)}`);
    }
  }
};