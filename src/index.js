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
import { handleAiTrain }         from "./routes/aiTrain.js"; // ⬅ ДОДАНО

// ---------- helpers ----------
const ADMIN = (env, userId) => String(userId) === String(env.TELEGRAM_ADMIN_ID);
const html = (s)=> new Response(s, { headers:{ "content-type":"text/html; charset=utf-8" }});
const json = (o, status=200)=> new Response(JSON.stringify(o, null, 2), { status, headers:{ "content-type":"application/json" }});
const needSecret = (env, url) => (env.WEBHOOK_SECRET && (url.searchParams.get("s") !== env.WEBHOOK_SECRET));

// ---------- small UI for root ----------
function home(env) {
  const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
  const link = (path) => abs(env, path);
  const linkS = (path) => abs(env, `${path}${path.includes("?") ? "&" : "?"}s=${s}`);

  return `<!doctype html>
<meta charset="utf-8">
<title>Senti Worker</title>
<style>
  :root { color-scheme: light dark }
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell; margin:24px; line-height:1.45}
  h1{margin:0 0 12px}
  .grid{display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
  a.btn{display:block; padding:10px 12px; border:1px solid #ddd; border-radius:10px; text-decoration:none; color:inherit; background:#f9f9fb}
  a.btn:hover{background:#f0f0f3}
  small{color:#666}
</style>
<h1>⚙️ Senti Worker Active</h1>
<p><small>Service: ${env.SERVICE_HOST || ""}</small></p>
<div class="grid">
  <a class="btn" href="${link("/health")}">✅ Health</a>
  <a class="btn" href="${link("/webhook")}">📡 Webhook (GET alive)</a>
  <a class="btn" href="${linkS("/selftest/run")}">🧪 SelfTest</a>

  <a class="btn" href="${linkS("/admin/checklist/html")}">📋 Checklist (HTML)</a>
  <a class="btn" href="${linkS("/admin/repo/html")}">📚 Repo (HTML)</a>
  <a class="btn" href="${linkS("/admin/statut/html")}">📜 Statut (HTML)</a>

  <a class="btn" href="${link("/api/brain/current")}">🧠 Brain: current</a>
  <a class="btn" href="${linkS("/api/brain/list")}">🧠 Brain: list</a>
  <a class="btn" href="${link("/brain/state")}">🧩 Brain state (JSON)</a>

  <a class="btn" href="${linkS("/ai/train/analyze")}">🤖 AI-Train (Analyze)</a> <!-- ⬅ НОВЕ -->
</div>`;
}

// ---------- HTTP worker ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

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
        if (req.method === "POST") {
          const sec = req.headers.get("x-telegram-bot-api-secret-token");
          if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
            return json({ ok:false, error:"unauthorized" }, 401);
          }
        }
        return await handleTelegramWebhook(req, env);
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

      // ---- not found ----
      return json({ ok:false, error:"Not found" }, 404);

    } catch (e) {
      return json({ ok:false, error:String(e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    await logHeartbeat(env);
  }
};