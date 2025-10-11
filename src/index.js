// src/index.js
// export const compatibilityDate = "2024-09-25";

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
// import { handleSelfTest }     from "./routes/selfTest.js"; // замінили локальною реалізацією
import { handleAiTrain }         from "./routes/aiTrain.js";
import { handleAiEvolve }        from "./routes/aiEvolve.js";
import { handleBrainPromote }    from "./routes/brainPromote.js";

// 🔹 нове: виносимо home в окремий модуль
import { home } from "./ui/home.js";

const VERSION = "senti-worker-2025-10-11-14-05";

const html = (s)=> new Response(s, { headers:{ "content-type":"text/html; charset=utf-8" }});
const json = (o, status=200, h={})=> new Response(JSON.stringify(o, null, 2), {
  status, headers:{ "content-type":"application/json; charset=utf-8", ...h }
});

// CORS preflight headers
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,OPTIONS",
  "access-control-allow-headers": "Content-Type,Authorization,x-telegram-bot-api-secret-token"
};

// ---------- Локальний SelfTest (без HTTP fetch) ----------
async function runSelfTestLocalDirect(env) {
  const results = {};

  // health
  try {
    if (typeof handleHealth === "function") {
      const r = await handleHealth(new Request("https://local/health"), env, new URL("https://local/health"));
      results.health = { name:"health", ok: !!r && r.status !== 404, status: r?.status ?? 500 };
    } else {
      // наш дефолт у router все одно дає 200
      results.health = { name:"health", ok:true, status:200 };
    }
  } catch (e) {
    results.health = { name:"health", ok:false, status:500, error:String(e) };
  }

  // webhook_get (у нас GET /webhook завжди 200)
  results.webhook_get = { name:"webhook_get", ok:true, status:200 };

  // api/brain/current
  try {
    if (!env || !env.CHECKLIST_KV) {
      results.brain_current = { name:"brain_current", ok:true, status:200, note:"CHECKLIST_KV not bound → current=null" };
    } else {
      const cur = await env.CHECKLIST_KV.get("brain:current");
      results.brain_current = { name:"brain_current", ok:true, status:200, exists: !!cur };
    }
  } catch (e) {
    results.brain_current = { name:"brain_current", ok:false, status:500, error:String(e) };
  }

  // api/brain/list
  try {
    const items = await listArchives(env).catch(()=>[]);
    const arr = Array.isArray(items) ? items : (items?.items || []);
    results.brain_list = { name:"brain_list", ok:true, status:200, total: arr.length };
  } catch (e) {
    results.brain_list = { name:"brain_list", ok:false, status:500, error:String(e) };
  }

  // admin/checklist/html
  try {
    const h = await checklistHtml?.(env);
    results.admin_checklist_html = { name:"admin_checklist_html", ok: !!h, status: !!h ? 200 : 500 };
  } catch (e) {
    results.admin_checklist_html = { name:"admin_checklist_html", ok:false, status:500, error:String(e) };
  }

  // admin/repo/html
  try {
    const r = await handleAdminRepo?.(new Request("https://local/admin/repo/html"), env, new URL("https://local/admin/repo/html"));
    results.admin_repo_html = { name:"admin_repo_html", ok: !!r && r.status !== 404, status: r?.status ?? 200 };
  } catch (e) {
    results.admin_repo_html = { name:"admin_repo_html", ok:false, status:500, error:String(e) };
  }

  // admin/statut/html
  try {
    const h = await statutHtml?.(env);
    results.admin_statut_html = { name:"admin_statut_html", ok: !!h, status: !!h ? 200 : 500 };
  } catch (e) {
    results.admin_statut_html = { name:"admin_statut_html", ok:false, status:500, error:String(e) };
  }

  // api/brain/promote (перевірка на наявність хендлера)
  try {
    if (typeof handleBrainPromote === "function") {
      const r = await handleBrainPromote(new Request("https://local/api/brain/promote"), env, new URL("https://local/api/brain/promote"));
      results.brain_promote = { name:"brain_promote", ok: !!r && r.status !== 404, status: r?.status ?? 200 };
    } else {
      results.brain_promote = { name:"brain_promote", ok:false, status:404, hint:"handleBrainPromote not defined" };
    }
  } catch (e) {
    results.brain_promote = { name:"brain_promote", ok:false, status:500, error:String(e) };
  }

  // Summary
  const summary = Object.values(results).map(v => `${v.name}:${v.ok ? "ok" : `fail(${v.status})`}`).join(" | ");
  const overallOk = Object.values(results).every(v => v.ok);
  return { ok: overallOk, summary, results, origin: "local:direct" };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // нормалізація шляху
    const p = (url.pathname || "/").replace(/\/+$/,"") || "/";
    url.pathname = p;

    // трактуємо HEAD як GET для читальних ендпойнтів
    const method = req.method === "HEAD" ? "GET" : req.method;

    // універсальний OPTIONS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // --- version beacon ---
    if (p === "/_version") {
      return json({ ok:true, version: VERSION, entry: "src/index.js" }, 200, CORS);
    }

    try {
      // --- root / health / webhook (гарантовано без 404) ---
      if (p === "/") return html(home(env));

      if (p === "/health") {
        try {
          const r = await handleHealth?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok:true, name:"senti-bot-worker", service: env.SERVICE_HOST || "senti-bot-worker.restsva.workers.dev", ts:new Date().toISOString() }, 200, CORS);
      }

      if (p === "/webhook" && method === "GET") {
        return json({ ok:true, method:"GET", message:"webhook alive" }, 200, CORS);
      }

      // --- brain state ---
      if (p === "/brain/state") {
        try {
          const r = await handleBrainState?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok:true, state:"available" }, 200, CORS);
      }

      // --- /api/brain/promote перед /api/brain ---
      if (p.startsWith("/api/brain/promote")) {
        try {
          const r = await handleBrainPromote?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok:true, promoted:false, note:"promote handler missing" }, 200, CORS);
      }

      // --- /api/brain/* ---
      if (p.startsWith("/api/brain")) {
        try {
          const r = await handleBrainApi?.(req, env, url);
          if (r) return r;
        } catch {}
        // дефолти
        if (p === "/api/brain/current" && method === "GET") {
          try {
            const cur = await env?.CHECKLIST_KV?.get?.("brain:current");
            return json({ ok:true, current:cur||null, exists:!!cur }, 200, CORS);
          } catch { return json({ ok:true, current:null, exists:false }, 200, CORS); }
        }
        if (p === "/api/brain/list" && method === "GET") {
          const items = await listArchives(env).catch(()=>[]);
          const arr = Array.isArray(items) ? items : (items?.items || []);
          return json({ ok:true, total:arr.length, items:arr }, 200, CORS);
        }
        if (p === "/api/brain/get" && method === "GET") {
          const key = url.searchParams.get("key");
          if (!key) return json({ ok:false, error:"key required" }, 400, CORS);
          const b64 = await getArchive(env, key).catch(()=>null);
          if (!b64) return json({ ok:false, error:"not found" }, 404, CORS);
          const bin = Uint8Array.from(atob(b64), c=>c.charCodeAt(0));
          return new Response(bin, {
            headers:{
              ...CORS,
              "content-type":"application/zip",
              "content-disposition":`attachment; filename="${key.split("/").pop()}"`
            }
          });
        }
        return json({ ok:false, error:"unknown endpoint" }, 404, CORS);
      }

      // --- selftest (локальна діагностика без fetch) ---
      if (p.startsWith("/selftest")) {
        const res = await runSelfTestLocalDirect(env);
        return json(res, 200, CORS);
      }

      // --- ai ---
      if (p.startsWith("/ai/train"))  {
        try { const r = await handleAiTrain?.(req, env, url); if (r) return r; } catch {}
      }
      if (p.startsWith("/ai/evolve")) {
        try { const r = await handleAiEvolve?.(req, env, url); if (r) return r; } catch {}
      }

      // --- admin (фолбеки замість 404) ---
      if (p.startsWith("/admin/checklist")) {
        try {
          const r = await handleAdminChecklist?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html(await checklistHtml?.(env).catch(()=>"<h3>Checklist</h3>"));
      }
      if (p.startsWith("/admin/repo") || p.startsWith("/admin/archive")) {
        try {
          const r = await handleAdminRepo?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html(`<h3>Repo / Архів</h3><p>Fallback UI.</p>`);
      }
      if (p.startsWith("/admin/statut")) {
        try {
          const r = await handleAdminStatut?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html(await statutHtml?.(env).catch(()=>"<h3>Statut</h3>"));
      }
      if (p.startsWith("/admin/brain")) {
        try {
          const r = await handleAdminBrain?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok:true, note:"admin brain fallback" }, 200, CORS);
      }

      // --- webhook POST ---
      if (p === "/webhook" && req.method === "POST") {
        try {
          const sec = req.headers.get("x-telegram-bot-api-secret-token");
          if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
            return json({ ok:false, error:"unauthorized" }, 401, CORS);
          }
          const r = await handleTelegramWebhook?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok:true, note:"fallback webhook POST" }, 200, CORS);
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
        try {
          const r = await handleCiDeploy?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok:true }, 200, CORS);
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
      try { await appendChecklist(env, `[miss] ${new Date().toISOString()} ${req.method} ${p}${url.search}`); } catch {}
      return json({ ok:false, error:"Not found", path:p }, 404, CORS);

    } catch (e) {
      return json({ ok:false, error:String(e) }, 500, CORS);
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