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

// ✅ Learn (admin only) + queue
import { handleAdminLearn } from "./routes/adminLearn.js";
import { runLearnOnce } from "./lib/kvLearnQueue.js";

import { runSelfTestLocalDirect } from "./routes/selfTestLocal.js";
import { fallbackBrainCurrent, fallbackBrainList, fallbackBrainGet } from "./routes/brainFallbacks.js";
import { home } from "./ui/home.js";
import { nightlyAutoImprove } from "./lib/autoImprove.js";
import { runSelfRegulation } from "./lib/selfRegulate.js";
import { handleAiImprove } from "./routes/aiImprove.js";

// ✅ Storage usage (R2 + KV)
import { handleAdminUsage } from "./routes/adminUsage.js";

const VERSION = "senti-worker-2025-10-20-learn-admin-only";

// локальний esc для безпечного виводу в HTML (викор. у /admin/*/run)
function esc(s = "") {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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
      return json({ ok: true, version: VERSION, entry: "src/index.js" }, 200, CORS);
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

      // ===== Brain/API =====
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
        if (p === "/api/brain/current" && method === "GET") return await fallbackBrainCurrent(env);
        if (p === "/api/brain/list" && method === "GET") return await fallbackBrainList(env);
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
        if (!["GET", "POST"].includes(req.method)) return json({ ok: false, error: "method not allowed" }, 405, CORS);
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        const u = new URL(abs(env, "/ai/evolve/auto"));
        if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);
        const innerReq = new Request(u.toString(), { method: "GET" });
        const r = await handleAiEvolve?.(innerReq, env, u);
        if (r) return r;
        return json({ ok: true, note: "evolve triggered" }, 200, CORS);
      }

      // nightly auto-improve manual
      if (p === "/cron/auto-improve") {
        if (!["GET", "POST"].includes(req.method)) return json({ ok: false, error: "method not allowed" }, 405, CORS);
        if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        const res = await nightlyAutoImprove(env, { now: new Date(), reason: "manual" });
        if (String(env.SELF_REGULATE || "on").toLowerCase() !== "off") {
          await runSelfRegulation(env, res?.insights || null).catch(() => {});
        }
        return json({ ok: true, ...res }, 200, CORS);
      }

      // ai/improve + debug
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
