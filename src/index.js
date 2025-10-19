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
import { handleAdminEnergy } from "./routes/adminEnergy.js";
import { handleAdminChecklistWithEnergy } from "./routes/adminChecklistWrap.js";

// ✅ нове: Learn admin-сторінка
import { handleAdminLearn } from "./routes/adminLearn.js";

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

const VERSION = "senti-worker-2025-10-19-12-40+learn-admin-run";

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

      // простий ping вебхука GET
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

      // ---- CRON і ручні тригери еволюції/нічного ----

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
      // 0) Learn (нова адмінка з чергами і ручним запуском)
      if (p.startsWith("/admin/learn")) {
        try {
          const r = await handleAdminLearn?.(req, env, url);
          if (r && r.status !== 404) return r;
        } catch {}
        return html("<h3>Learn</h3><p>Fallback UI.</p>");
      }

      // 1) Комбінована сторінка: Checklist + Energy (iframe)
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
        // виправлено кириличну 'р' у попередніх комітах
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

      // webhook POST (Telegram)
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

      // OAuth — Google Drive
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
          expiry: Math.floor(Date.now() / 1000) + (d.expires_in || 3600) - 60,
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
        const res = await nightlyAutoImprove(env, { now: new Date(), reason: event?.cron || `utc@${hour}` });
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