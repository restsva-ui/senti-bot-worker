// src/index.js
// export const compatibilityDate = "2024-09-25";

import { TG } from "./lib/tg.js";
import { putUserTokens } from "./lib/userDrive.js";
import {
  checklistHtml,
  statutHtml,
  appendChecklist,
} from "./lib/kvChecklist.js";
import { logHeartbeat } from "./lib/audit.js";
import { abs } from "./utils/url.js";

// http utils
import { html, json, CORS, preflight } from "./utils/http.js";

// routes
import { handleAdminRepo } from "./routes/adminRepo.js";
import { handleAdminChecklist } from "./routes/adminChecklist.js";
import { handleAdminStatut } from "./routes/adminStatut.js";
import { handleAdminBrain } from "./routes/adminBrain.js";
import { handleTelegramWebhook } from "./routes/webhook.js";
import { handleHealth } from "./routes/health.js";
import { handleBrainState } from "./routes/brainState.js";
import { handleCiDeploy } from "./routes/ciDeploy.js";
import { handleBrainApi } from "./routes/brainApi.js";
import { handleAiTrain } from "./routes/aiTrain.js";
import { handleAiEvolve } from "./routes/aiEvolve.js";
import { handleBrainPromote } from "./routes/brainPromote.js";
import { handleAdminEnergy } from "./routes/adminEnergy.js"; // energy UI/API
import { handleAdminChecklistWithEnergy } from "./routes/adminChecklistWrap.js"; // ← ДОДАНО

// ✅ локальний selftest
import { runSelfTestLocalDirect } from "./routes/selfTestLocal.js";

// ✅ фолбеки /api/brain/*
import {
  fallbackBrainCurrent,
  fallbackBrainList,
  fallbackBrainGet,
} from "./routes/brainFallbacks.js";

// home
import { home } from "./ui/home.js";

// ✅ нічні авто-поліпшення (CRON-варіант)
import { nightlyAutoImprove } from "./lib/autoImprove.js";

// ✅ self-regulation
import { runSelfRegulation } from "./lib/selfRegulate.js";

// ✅ HTTP-роутер нічного агента + debug (/ai/improve*, /debug/*)
import { handleAiImprove } from "./routes/aiImprove.js";

const VERSION =
  "senti-worker-2025-10-15-18-50+kv-editor-inline+kv-api-fix";

// ─────────────────────────────────────────────────────────────────────────────
// KV helpers for code storage (read/write/list) — uses CODE_KV or STATE_KV
function codeKV(env) {
  return env.CODE_KV || env.STATE_KV;
}
async function codeGet(env, path) {
  const kv = codeKV(env);
  if (!kv) return null;
  const key = `code:${path}`;
  return await kv.get(key, "text");
}
async function codePut(env, path, content) {
  const kv = codeKV(env);
  if (!kv) throw new Error("KV not configured");
  const key = `code:${path}`;
  await kv.put(key, content, {
    metadata: { path, ts: Date.now() },
  });
  return true;
}
async function codeList(env) {
  const kv = codeKV(env);
  if (!kv) return [];
  const it = await kv.list({ prefix: "code:" });
  return (it?.keys || []).map((k) => ({
    key: k.name.replace(/^code:/, ""),
    ts: k?.metadata?.ts || null,
  }));
}
// ─────────────────────────────────────────────────────────────────────────────
// General KV (STATE/CODE/ARCHIVE) editor API + UI

function getNS(env, ns) {
  if (ns === "CODE_KV") return env.CODE_KV || env.STATE_KV;
  if (ns === "ARCHIVE_KV") return env.ARCHIVE_KV || env.STATE_KV;
  return env.STATE_KV; // default
}

function kvEditorHtml(env, url) {
  const s = url.searchParams.get("s") || "";
  const ns = url.searchParams.get("ns") || "STATE_KV";
  const base = abs(env, "/admin/kv");
  const listUrl = (params) => {
    const u = new URL(abs(env, "/admin/kv/list"));
    u.searchParams.set("s", s);
    Object.entries(params || {}).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
    return u.toString();
  };
  const getUrl = (params) => {
    const u = new URL(abs(env, "/admin/kv/get"));
    u.searchParams.set("s", s);
    Object.entries(params || {}).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
    return u.toString();
  };
  const putUrl = (params) => {
    const u = new URL(abs(env, "/admin/kv/put"));
    u.searchParams.set("s", s);
    Object.entries(params || {}).forEach(([k, v]) => v != null && u.searchParams.set(k, v));
    return u.toString();
  };
  const checklist = abs(env, "/admin/checklist/html?s=" + encodeURIComponent(s));

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>KV Editor</title>
<style>
  :root{--bg:#0f1115;--fg:#eaeefb;--muted:#9aa4b2;--accent:#8ab4ff;--surface:#171a21;--btn:#222633}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
  a{color:var(--accent);text-decoration:none}
  .wrap{max-width:1100px;margin:0 auto;padding:12px}
  .top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .pill{background:var(--btn);border-radius:999px;padding:8px 12px}
  select,input,textarea,button{background:var(--surface);color:var(--fg);border:1px solid #2a2f3a;border-radius:12px;padding:10px}
  input,select{height:40px}
  textarea{width:100%;min-height:50vh;border-radius:14px}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  .row>*{flex:1}
  .row .w60{flex:0 0 60%}
  .row .w20{flex:0 0 20%}
  .btn{cursor:pointer}
  .hint{color:var(--muted);font-size:12px}
  .toast{margin-top:8px;font-size:13px}
  @media (max-width:700px){
    .row .w60,.row .w20{flex:1 0 100%}
    textarea{min-height:55vh}
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <span class="pill">KV Editor · <b id="nsLbl">${ns}</b></span>
    <a class="pill" href="${checklist}">← До Checklist</a>
  </div>

  <div class="row">
    <select id="ns" class="w20">
      <option value="STATE_KV"${ns==="STATE_KV"?" selected":""}>STATE_KV</option>
      <option value="CODE_KV"${ns==="CODE_KV"?" selected":""}>CODE_KV</option>
      <option value="ARCHIVE_KV"${ns==="ARCHIVE_KV"?" selected":""}>ARCHIVE_KV</option>
    </select>
    <input id="prefix" placeholder="prefix (optional)" class="w60"/>
    <button id="btnList" class="btn w20">List</button>
  </div>

  <div class="row">
    <input id="key" placeholder="key" class="w60"/>
    <button id="btnLoad" class="btn w20">Load</button>
    <button id="btnNew" class="btn w20">New</button>
    <button id="btnSave" class="btn w20">Save</button>
  </div>

  <textarea id="val" placeholder='value (JSON/string)'></textarea>
  <div id="toast" class="toast"></div>

  <p class="hint">Порада: Save робить <code>POST</code> на <code>/admin/kv/put?ns=&key=&s=...</code> із сирим тілом.</p>
</div>

<script>
  const S="${s}";
  const base="${base}";
  const listUrl=${listUrl.toString()};
  const getUrl=${getUrl.toString()};
  const putUrl=${putUrl.toString()};

  const $ = (id)=>document.getElementById(id);
  const nsEl=$("ns"), nsLbl=$("nsLbl"), prefix=$("prefix"), keyEl=$("key"), val=$("val"), toast=$("toast");

  nsEl.addEventListener("change", ()=>{
    const u=new URL(base); u.searchParams.set("s",S); u.searchParams.set("ns", nsEl.value);
    location.href=u.toString();
  });

  $("btnList").onclick= async ()=>{
    toast.textContent="Listing...";
    const res = await fetch(listUrl({ns:nsEl.value, prefix:prefix.value||""}));
    const j = await res.json();
    toast.textContent = res.ok ? "OK: "+(j.items?.length||0)+" keys" : "List error";
    if (j.items) {
      alert(j.items.map(k=>k.name||k.key).join("\\n") || "(empty)");
    }
  };

  $("btnLoad").onclick= async ()=>{
    if (!keyEl.value) { toast.textContent="Set key first"; return; }
    toast.textContent="Loading...";
    const res = await fetch(getUrl({ns:nsEl.value, key:keyEl.value}));
    const j = await res.json();
    if (res.ok) { val.value = j.value ?? ""; toast.textContent="Loaded"; }
    else { toast.textContent="Load error: "+(j.error||res.status); }
  };

  $("btnNew").onclick= ()=>{
    const k = prompt("New key name (will not overwrite until Save):");
    if (k) { keyEl.value=k; val.value=""; toast.textContent="Ready"; }
  };

  $("btnSave").onclick= async ()=>{
    if (!keyEl.value) { toast.textContent="Set key first"; return; }
    toast.textContent="Saving...";
    const res = await fetch(putUrl({ns:nsEl.value, key:keyEl.value}), {method:"POST", body:val.value||""});
    const j = await res.json().catch(()=>({}));
    toast.textContent = res.ok ? "✅ Saved ("+(j.bytes||0)+" bytes)" : "Save error: "+(j.error||res.status);
  };
</script>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = (url.pathname || "/").replace(/\/+$/, "") || "/";
    url.pathname = p;

    const method = req.method === "HEAD" ? "GET" : req.method;

    if (req.method === "OPTIONS") {
      return preflight();
    }

    // version beacon
    if (p === "/_version") {
      return json({ ok: true, version: VERSION, entry: "src/index.js" }, 200, CORS);
    }

    try {
      // root / health / webhook
      if (p === "/") return html(home(env));

      if (p === "/health") {
        try {
          const r = await handleHealth?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json(
          {
            ok: true,
            name: "senti-bot-worker",
            service: env.SERVICE_HOST || "senti-bot-worker.restsva.workers.dev",
            ts: new Date().toISOString(),
          },
          200,
          CORS
        );
      }

      if (p === "/webhook" && method === "GET") {
        return json({ ok: true, method: "GET", message: "webhook alive" }, 200, CORS);
      }

      // brain state
      if (p === "/brain/state") {
        try {
          const r = await handleBrainState?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok: true, state: "available" }, 200, CORS);
      }

      // /api/brain/promote
      if (p.startsWith("/api/brain/promote")) {
        try {
          const r = await handleBrainPromote?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok: true, promoted: false, note: "promote handler missing" }, 200, CORS);
      }

      // /api/brain/*
      if (p.startsWith("/api/brain")) {
        try {
          const r = await handleBrainApi?.(req, env, url);
          if (r) return r;
        } catch {}
        if (p === "/api/brain/current" && method === "GET") {
          return await fallbackBrainCurrent(env);
        }
        if (p === "/api/brain/list" && method === "GET") {
          return await fallbackBrainList(env);
        }
        if (p === "/api/brain/get" && method === "GET") {
          const key = url.searchParams.get("key");
          return await fallbackBrainGet(env, key);
        }
        return json({ ok: false, error: "unknown endpoint" }, 404, CORS);
      }

      // selftest
      if (p.startsWith("/selftest")) {
        const res = await runSelfTestLocalDirect(env);
        return json(res, 200, CORS);
      }

      // cron evolve (manual trigger)
      if (p === "/cron/evolve") {
        if (req.method !== "GET" && req.method !== "POST") {
          return json({ ok: false, error: "method not allowed" }, 405, CORS);
        }
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        }
        const u = new URL(abs(env, "/ai/evolve/auto"));
        if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);
        const innerReq = new Request(u.toString(), { method: "GET" });
        const r = await handleAiEvolve?.(innerReq, env, u);
        if (r) return r;
        return json({ ok: true, note: "evolve triggered" }, 200, CORS);
      }

      // cron auto-improve (CRON path keeps lib variant)
      if (p === "/cron/auto-improve") {
        if (req.method !== "GET" && req.method !== "POST") {
          return json({ ok: false, error: "method not allowed" }, 405, CORS);
        }
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        }
        const res = await nightlyAutoImprove(env, { now: new Date(), reason: "manual" });
        if (String(env.SELF_REGULATE || "on").toLowerCase() !== "off") {
          await runSelfRegulation(env, res?.insights || null).catch(() => {});
        }
        return json({ ok: true, ...res }, 200, CORS);
      }

      // ✅ /ai/improve* та ✅ /debug/* — віддаємо у routes/aiImprove.js
      if (p.startsWith("/ai/improve") || p.startsWith("/debug/")) {
        const r = await handleAiImprove?.(req, env, url);
        if (r) return r;
        return json({ ok: false, error: "aiImprove router missing" }, 500, CORS);
      }

      // on-demand self-regulation (без аналізу)
      if (p === "/ai/self-regulate") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        }
        const res = await runSelfRegulation(env, null);
        return json({ ok: true, ...res }, 200, CORS);
      }

      // ai train/evolve
      if (p.startsWith("/ai/train")) {
        try {
          const r = await handleAiTrain?.(req, env, url);
          if (r) return r;
        } catch {}
      }
      if (p.startsWith("/ai/evolve")) {
        try {
          const r = await handleAiEvolve?.(req, env, url);
          if (r) return r;
        } catch {}
      }

      // --- ADMIN ---
      // 1) Комбінована сторінка: Checklist + Energy (ifrаme)
      if (p.startsWith("/admin/checklist/with-energy")) {
        try {
          const r = await handleAdminChecklistWithEnergy?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html("<h3>Checklist + Energy</h3><p>Fallback UI.</p>");
      }

      // 2) Звичайний Checklist
      if (p.startsWith("/admin/checklist")) {
        try {
          const r = await handleAdminChecklist?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html(await checklistHtml?.(env).catch(() => "<h3>Checklist</h3>"));
      }

      // 3) Repo / Архів
      if (p.startsWith("/admin/repo") || p.startsWith("/admin/archive")) {
        try {
          const r = await handleAdminRepo?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html(`<h3>Repo / Архів</h3><p>Fallback UI.</p>`);
      }

      // 4) Статут
      if (p.startsWith("/admin/statut")) {
        try {
          const r = await handleAdminStatut?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html(await statutHtml?.(env).catch(() => "<h3>Statut</h3>"));
      }

      // 5) Brain
      if (p.startsWith("/admin/brain")) {
        try {
          const r = await handleAdminBrain?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok: true, note: "admin brain fallback" }, 200, CORS);
      }

      // 6) Energy
      if (p.startsWith("/admin/energy")) {
        try {
          const r = await handleAdminEnergy?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok: true, note: "admin energy fallback" }, 200, CORS);
      }

      // ────────────────────────────────────────────────────────────────────
      // NEW: Simple KV-backed code repo API (list/get/put)
      if (p === "/admin/api/list") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        }
        const items = await codeList(env);
        return json({ ok: true, items }, 200, CORS);
      }

      if (p === "/admin/api/get") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        }
        const path = url.searchParams.get("path") || "";
        if (!path) return json({ ok: false, error: "path required" }, 400, CORS);
        const value = await codeGet(env, path);
        return json({ ok: true, path, value }, 200, CORS);
      }

      if (p === "/admin/api/put") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        }
        if (method !== "POST") {
          return json({ ok: false, error: "method not allowed" }, 405, CORS);
        }
        const path = url.searchParams.get("path") || "";
        if (!path) return json({ ok: false, error: "path required" }, 400, CORS);
        const bodyText = await req.text();
        if (!bodyText?.length) {
          return json({ ok: false, error: "empty body" }, 400, CORS);
        }
        await codePut(env, path, bodyText);
        return json({ ok: true, saved: true, path, bytes: bodyText.length }, 200, CORS);
      }
      // ────────────────────────────────────────────────────────────────────
      // KV EDITOR UI + API

      if (p === "/admin/kv") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return html("<h3>Unauthorized</h3>", 401);
        }
        return html(kvEditorHtml(env, url));
      }

      if (p === "/admin/kv/list") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        }
        const ns = url.searchParams.get("ns") || "STATE_KV";
        const prefix = url.searchParams.get("prefix") || "";
        const kv = getNS(env, ns);
        if (!kv) return json({ ok: false, error: "kv missing" }, 500, CORS);
        const it = await kv.list(prefix ? { prefix } : {});
        const items = (it?.keys || []).map((k) => ({
          name: k.name,
          ts: k?.metadata?.ts || null,
        }));
        return json({ ok: true, items }, 200, CORS);
      }

      if (p === "/admin/kv/get") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        }
        const ns = url.searchParams.get("ns") || "STATE_KV";
        const key = url.searchParams.get("key");
        if (!key) return json({ ok: false, error: "key required" }, 400, CORS);
        const kv = getNS(env, ns);
        if (!kv) return json({ ok: false, error: "kv missing" }, 500, CORS);
        const value = await kv.get(key, "text");
        return json({ ok: true, key, value }, 200, CORS);
      }

      if (p === "/admin/kv/put") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        }
        if (method !== "POST") {
          return json({ ok: false, error: "method not allowed" }, 405, CORS);
        }
        const ns = url.searchParams.get("ns") || "STATE_KV";
        const key = url.searchParams.get("key");
        if (!key) return json({ ok: false, error: "key required" }, 400, CORS);
        const body = await req.text();
        const kv = getNS(env, ns);
        if (!kv) return json({ ok: false, error: "kv missing" }, 500, CORS);
        await kv.put(key, body);
        return json({ ok: true, key, bytes: body.length }, 200, CORS);
      }

      // webhook POST
      if (p === "/webhook" && req.method === "POST") {
        try {
          const sec = req.headers.get("x-telegram-bot-api-secret-token");
          if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
            return json({ ok: false, error: "unauthorized" }, 401, CORS);
          }
          const r = await handleTelegramWebhook?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok: true, note: "fallback webhook POST" }, 200, CORS);
      }

      // tg helpers
      if (p === "/tg/get-webhook") {
        const r = await TG.getWebhook(env.BOT_TOKEN);
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" },
        });
      }
      if (p === "/tg/set-webhook") {
        const target = abs(env, "/webhook");
        const r = await TG.setWebhook(env.BOT_TOKEN, target, env.TG_WEBHOOK_SECRET);
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" },
        });
      }
      if (p === "/tg/del-webhook") {
        const r =
          (await TG.deleteWebhook?.(env.BOT_TOKEN)) ||
          (await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook`));
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" },
        });
      }

      // ci deploy
      if (p.startsWith("/ci/deploy-note")) {
        try {
          const r = await handleCiDeploy?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok: true }, 200, CORS);
      }

      // oauth
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
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const d = await r.json();
        if (!r.ok) return html(`<pre>${JSON.stringify(d, null, 2)}</pre>`);
        const tokens = {
          access_token: d.access_token,
          refresh_token: d.refresh_token,
          expiry:
            Math.floor(Date.now() / 1000) + (d.expires_in || 3600) - 60,
        };
        await putUserTokens(env, state.u, tokens);
        return html(
          `<h3>✅ Готово</h3><p>Тепер повернись у Telegram і натисни <b>Google Drive</b> ще раз.</p>`
        );
      }

      // not found
      try {
        await appendChecklist(
          env,
          `[miss] ${new Date().toISOString()} ${req.method} ${p}${url.search}`
        );
      } catch {}
      return json({ ok: false, error: "Not found", path: p }, 404, CORS);
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500, CORS);
    }
  },

  async scheduled(event, env) {
    await logHeartbeat(env);

    // 1) Годинний evolve
    try {
      if (event && event.cron === "0 * * * *") {
        const u = new URL(abs(env, "/ai/evolve/auto"));
        if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);
        const req = new Request(u.toString(), { method: "GET" });
        await handleAiEvolve?.(req, env, u);
      }
    } catch (e) {
      await appendChecklist(
        env,
        `[${new Date().toISOString()}] evolve_auto:error ${String(e)}`
      );
    }

    // 2) Нічні авто-поліпшення + self-regulation
    try {
      const hour = new Date().getUTCHours();
      const targetHour = Number(env.NIGHTLY_UTC_HOUR ?? 2); // дефолт 02:00 UTC
      const runByCron = event && event.cron === "10 2 * * *";
      const runByHour = hour === targetHour;

      if (
        String(env.AUTO_IMPROVE || "on").toLowerCase() !== "off" &&
        (runByCron || runByHour)
      ) {
        const res = await nightlyAutoImprove(env, {
          now: new Date(),
          reason: event?.cron || `utc@${hour}`,
        });
        if (String(env.SELF_REGULATE || "on").toLowerCase() !== "off") {
          await runSelfRegulation(env, res?.insights || null).catch(() => {});
        }
      }
    } catch (e) {
      await appendChecklist(
        env,
        `[${new Date().toISOString()}] auto_improve:error ${String(e)}`
      );
    }
  },
};