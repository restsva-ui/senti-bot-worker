// src/index.js
import { TG } from "./lib/tg.js";
import { putUserTokens } from "./lib/userDrive.js";
import { checklistHtml, statutHtml, appendChecklist } from "./lib/kvChecklist.js";
import { logHeartbeat } from "./lib/audit.js";
import { abs } from "./utils/url.js";
import { html, json, CORS, preflight } from "./utils/http.js";

// Routers
import { handleAdminRepo } from "./routes/adminRepo.js";
import { handleAdminChecklist } from "./routes/adminChecklist.js";
import { handleAdminStatut } from "./routes/adminStatut.js";
import { handleAdminBrain } from "./routes/adminBrain.js";
import webhook from "./routes/webhook.js"; 
import { handleHealth } from "./routes/health.js";
import { handleBrainState } from "./routes/brainState.js";
import { handleCiDeploy } from "./routes/ciDeploy.js";
import { handleBrainApi } from "./routes/brainApi.js";
import { handleAiTrain } from "./routes/aiTrain.js";
import { handleAiEvolve } from "./routes/aiEvolve.js";
import { handleBrainPromote } from "./routes/brainPromote.js";
import { handleAdminEnergy } from "./routes/adminEnergy.js";
import { handleAdminChecklistWithEnergy } from "./routes/adminChecklistWrap.js";

// Learn / queue
import { handleAdminLearn } from "./routes/adminLearn.js";
import { runLearnOnce } from "./lib/kvLearnQueue.js";

import { runSelfTestLocalDirect } from "./routes/selfTestLocal.js";
import { fallbackBrainCurrent, fallbackBrainList, fallbackBrainGet } from "./routes/brainFallbacks.js";
import { home } from "./ui/home.js";
import { nightlyAutoImprove } from "./lib/autoImprove.js";
import { runSelfRegulation } from "./lib/selfRegulate.js";
import { handleAiImprove } from "./routes/aiImprove.js";

// Storage usage
import { handleAdminUsage } from "./routes/adminUsage.js";

const VERSION = "senti-worker-2025-10-20-learn-admin-only";

// Safe HTML escape
function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = (url.pathname || "/").replace(/\/+$/, "") || "/";
    url.pathname = p;
    const method = req.method === "HEAD" ? "GET" : req.method;

    if (req.method === "OPTIONS") return preflight();

    // version
    if (p === "/_version") {
      return json(
        { ok: true, version: VERSION, entry: "src/index.js" },
        200,
        CORS
      );
    }

    try {
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

      // Brain API
      if (p === "/brain/state") {
        try {
          const r = await handleBrainState?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok: true, state: "available" }, 200, CORS);
      }

      if (p.startsWith("/api/brain/promote")) {
        try {
          const r = await handleBrainPromote?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok: true, promoted: false, note: "promote handler missing" }, 200, CORS);
      }

      if (p.startsWith("/api/brain")) {
        try {
          const r = await handleBrainApi?.(req, env, url);
          if (r) return r;
        } catch {}
        if (p === "/api/brain/current" && method === "GET")
          return await fallbackBrainCurrent(env);
        if (p === "/api/brain/list" && method === "GET")
          return await fallbackBrainList(env);
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
      // cron evolve manual trigger
      if (p === "/cron/evolve") {
        if (!["GET", "POST"].includes(req.method))
          return json({ ok: false, error: "method not allowed" }, 405, CORS);

        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);

        const u = new URL(abs(env, "/ai/evolve/auto"));
        if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);

        const innerReq = new Request(u.toString(), { method: "GET" });
        const r = await handleAiEvolve?.(innerReq, env, u);
        if (r) return r;

        return json({ ok: true, note: "evolve triggered" }, 200, CORS);
      }

      // nightly auto improve manual
      if (p === "/cron/auto-improve") {
        if (!["GET", "POST"].includes(req.method))
          return json({ ok: false, error: "method not allowed" }, 405, CORS);

        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);

        const res = await nightlyAutoImprove(env, {
          now: new Date(),
          reason: "manual",
        });

        if (String(env.SELF_REGULATE || "on").toLowerCase() !== "off") {
          await runSelfRegulation(env, res?.insights || null).catch(() => {});
        }

        return json({ ok: true, ...res }, 200, CORS);
      }

      // ai/improve
      if (p.startsWith("/ai/improve") || p.startsWith("/debug/")) {
        const r = await handleAiImprove?.(req, env, url);
        if (r) return r;
        return json({ ok: false, error: "aiImprove router missing" }, 500, CORS);
      }

      // self-regulate on demand
      if (p === "/ai/self-regulate") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);

        const res = await runSelfRegulation(env, null);
        return json({ ok: true, ...res }, 200, CORS);
      }

      // Learn RUN merged endpoints
      if (
        (p === "/admin/learn/run" || p === "/admin/brain/run") &&
        (method === "GET" || method === "POST")
      ) {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);

        try {
          const maxItems = Number(url.searchParams.get("n") || 10);
          const out = await runLearnOnce(env, { maxItems });

          if (method === "GET") {
            const back = (() => {
              const u = new URL(url);
              u.pathname = "/admin/learn/html";
              return u.toString();
            })();

            return html(`
              <style>
                :root{color-scheme:dark}
                body{background:#0b0f14;color:#e6edf3;font-family:ui-sans-serif,system-ui}
                .wrap{max-width:980px;margin:0 auto;padding:12px}
                .card{background:#11161d;border:1px solid #1f2937;border-radius:12px;padding:14px}
                .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3;text-decoration:none}
                pre{white-space:pre-wrap;background:#0b1117;border:1px solid #1f2937;border-radius:10px;padding:10px}
              </style>
              <div class="wrap">
                <div class="card">
                  <b>Підсумок виконання</b>
                  <pre>${esc(out?.summary || JSON.stringify(out, null, 2))}</pre>
                  <p><a class="btn" href="${esc(back)}">← Назад</a></p>
                </div>
              </div>
            `);
          }

          return json(out, 200, CORS);
        } catch (e) {
          return json({ ok: false, error: String(e?.message || e) }, 500, CORS);
        }
      }

      // Learn (admin)
      if (p.startsWith("/admin/learn")) {
        const r = await handleAdminLearn?.(req, env, url);
        if (r) return r;
      }

      // Usage
      if (p.startsWith("/admin/usage")) {
        const r = await handleAdminUsage?.(req, env, url);
        if (r) return r;
      }

      // admin pages
      if (p.startsWith("/admin/checklist/with-energy")) {
        try {
          const r = await handleAdminChecklistWithEnergy?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html("<h3>Checklist + Energy</h3><p>Fallback UI.</p>");
      }

      if (p.startsWith("/admin/checklist")) {
        try {
          const r = await handleAdminChecklist?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html(await checklistHtml?.(env).catch(() => "<h3>Checklist</h3>"));
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
        return html(await statutHtml?.(env).catch(() => "<h3>Statut</h3>"));
      }

      if (p.startsWith("/admin/brain")) {
        try {
          const r = await handleAdminBrain?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok: true, note: "admin brain fallback" }, 200, CORS);
      }

      if (p.startsWith("/admin/energy")) {
        try {
          const r = await handleAdminEnergy?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok: true, note: "admin energy fallback" }, 200, CORS);
      }

      // webhook POST
      if (p === "/webhook" && req.method === "POST") {
        try {
          const sec = req.headers.get("x-telegram-bot-api-secret-token");
          if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
            return json({ ok: false, error: "unauthorized" }, 401, CORS);
          }

          const r = await webhook?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok: true, note: "fallback webhook POST" }, 200, CORS);
      }

      // Telegram helpers
      if (p === "/tg/get-webhook") {
        const r = await TG.getWebhook(env.BOT_TOKEN);
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" },
        });
      }

      if (p === "/tg/set-webhook") {
        const target = abs(env, "/webhook");
        const r = await TG.setWebhook(
          env.BOT_TOKEN,
          target,
          env.TG_WEBHOOK_SECRET
        );
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" },
        });
      }

      if (p === "/tg/del-webhook") {
        const r =
          (await TG.deleteWebhook?.(env.BOT_TOKEN)) ||
          (await fetch(
            `https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook`
          ));

        return new Response(await r.text(), {
          headers: { "content-type": "application/json" },
        });
      }

      // CI note
      if (p.startsWith("/ci/deploy-note")) {
        try {
          const r = await handleCiDeploy?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok: true }, 200, CORS);
      }
      // cron evolve manual trigger
      if (p === "/cron/evolve") {
        if (!["GET", "POST"].includes(req.method))
          return json({ ok: false, error: "method not allowed" }, 405, CORS);

        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);

        const u = new URL(abs(env, "/ai/evolve/auto"));
        if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);

        const innerReq = new Request(u.toString(), { method: "GET" });
        const r = await handleAiEvolve?.(innerReq, env, u);
        if (r) return r;

        return json({ ok: true, note: "evolve triggered" }, 200, CORS);
      }

      // nightly auto improve manual
      if (p === "/cron/auto-improve") {
        if (!["GET", "POST"].includes(req.method))
          return json({ ok: false, error: "method not allowed" }, 405, CORS);

        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);

        const res = await nightlyAutoImprove(env, {
          now: new Date(),
          reason: "manual",
        });

        if (String(env.SELF_REGULATE || "on").toLowerCase() !== "off") {
          await runSelfRegulation(env, res?.insights || null).catch(() => {});
        }

        return json({ ok: true, ...res }, 200, CORS);
      }

      // ai/improve
      if (p.startsWith("/ai/improve") || p.startsWith("/debug/")) {
        const r = await handleAiImprove?.(req, env, url);
        if (r) return r;
        return json({ ok: false, error: "aiImprove router missing" }, 500, CORS);
      }

      // self-regulate on demand
      if (p === "/ai/self-regulate") {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);

        const res = await runSelfRegulation(env, null);
        return json({ ok: true, ...res }, 200, CORS);
      }

      // Learn RUN merged endpoints
      if (
        (p === "/admin/learn/run" || p === "/admin/brain/run") &&
        (method === "GET" || method === "POST")
      ) {
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);

        try {
          const maxItems = Number(url.searchParams.get("n") || 10);
          const out = await runLearnOnce(env, { maxItems });

          if (method === "GET") {
            const back = (() => {
              const u = new URL(url);
              u.pathname = "/admin/learn/html";
              return u.toString();
            })();

            return html(`
              <style>
                :root{color-scheme:dark}
                body{background:#0b0f14;color:#e6edf3;font-family:ui-sans-serif,system-ui}
                .wrap{max-width:980px;margin:0 auto;padding:12px}
                .card{background:#11161d;border:1px solid #1f2937;border-radius:12px;padding:14px}
                .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3;text-decoration:none}
                pre{white-space:pre-wrap;background:#0b1117;border:1px solid #1f2937;border-radius:10px;padding:10px}
              </style>
              <div class="wrap">
                <div class="card">
                  <b>Підсумок виконання</b>
                  <pre>${esc(out?.summary || JSON.stringify(out, null, 2))}</pre>
                  <p><a class="btn" href="${esc(back)}">← Назад</a></p>
                </div>
              </div>
            `);
          }

          return json(out, 200, CORS);
        } catch (e) {
          return json({ ok: false, error: String(e?.message || e) }, 500, CORS);
        }
      }

      // Learn (admin)
      if (p.startsWith("/admin/learn")) {
        const r = await handleAdminLearn?.(req, env, url);
        if (r) return r;
      }

      // Usage
      if (p.startsWith("/admin/usage")) {
        const r = await handleAdminUsage?.(req, env, url);
        if (r) return r;
      }

      // admin pages
      if (p.startsWith("/admin/checklist/with-energy")) {
        try {
          const r = await handleAdminChecklistWithEnergy?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html("<h3>Checklist + Energy</h3><p>Fallback UI.</p>");
      }

      if (p.startsWith("/admin/checklist")) {
        try {
          const r = await handleAdminChecklist?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html(await checklistHtml?.(env).catch(() => "<h3>Checklist</h3>"));
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
        return html(await statutHtml?.(env).catch(() => "<h3>Statut</h3>"));
      }

      if (p.startsWith("/admin/brain")) {
        try {
          const r = await handleAdminBrain?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok: true, note: "admin brain fallback" }, 200, CORS);
      }

      if (p.startsWith("/admin/energy")) {
        try {
          const r = await handleAdminEnergy?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return json({ ok: true, note: "admin energy fallback" }, 200, CORS);
      }

      // webhook POST
      if (p === "/webhook" && req.method === "POST") {
        try {
          const sec = req.headers.get("x-telegram-bot-api-secret-token");
          if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET) {
            return json({ ok: false, error: "unauthorized" }, 401, CORS);
          }

          const r = await webhook?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok: true, note: "fallback webhook POST" }, 200, CORS);
      }

      // Telegram helpers
      if (p === "/tg/get-webhook") {
        const r = await TG.getWebhook(env.BOT_TOKEN);
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" },
        });
      }

      if (p === "/tg/set-webhook") {
        const target = abs(env, "/webhook");
        const r = await TG.setWebhook(
          env.BOT_TOKEN,
          target,
          env.TG_WEBHOOK_SECRET
        );
        return new Response(await r.text(), {
          headers: { "content-type": "application/json" },
        });
      }

      if (p === "/tg/del-webhook") {
        const r =
          (await TG.deleteWebhook?.(env.BOT_TOKEN)) ||
          (await fetch(
            `https://api.telegram.org/bot${env.BOT_TOKEN}/deleteWebhook`
          ));

        return new Response(await r.text(), {
          headers: { "content-type": "application/json" },
        });
      }

      // CI note
      if (p.startsWith("/ci/deploy-note")) {
        try {
          const r = await handleCiDeploy?.(req, env, url);
          if (r) return r;
        } catch {}
        return json({ ok: true }, 200, CORS);
      }
 
