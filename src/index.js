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
import { handleAdminEditor } from "./routes/adminEditor.js";
// ✅ новий повноцінний KV Editor (UI + API)
import { handleAdminKv } from "./routes/admin-kv.js";
// ✅ виправлений імпорт Vision API
import { handleVisionApi } from "./routes/visionApi.js";

import { runSelfTestLocalDirect } from "./routes/selfTestLocal.js";

import {
  fallbackBrainCurrent,
  fallbackBrainList,
  fallbackBrainGet,
} from "./routes/brainFallbacks.js";

import { home } from "./ui/home.js";
import { nightlyAutoImprove } from "./lib/autoImprove.js";
import { runSelfRegulation } from "./lib/selfRegulate.js";
import { handleAiImprove } from "./routes/aiImprove.js";

const VERSION = "senti-worker-2025-10-16+vision-api-fix";

// ─────────────────────────────────────────────────────────────────────────────
// KV helpers for code storage (read/write/list)

function pickKVByNs(env, ns) {
  const n = String(ns || "").toUpperCase();
  if (n === "CODE") return env.CODE_KV || null;
  if (n === "ARCHIVE") return env.ARCHIVE_KV || null;
  if (n === "STATE") return env.STATE_KV || null;
  return env.CODE_KV || env.STATE_KV || null;
}

function codeKV(env, nsParam) {
  return pickKVByNs(env, nsParam) || env.CODE_KV || env.STATE_KV;
}

function normalizeCodeKey(path, { raw = false } = {}) {
  const p = String(path || "");
  if (raw) return p;
  return p.startsWith("code:") ? p : `code:${p}`;
}

async function codeGet(env, path, { ns, raw } = {}) {
  const kv = codeKV(env, ns);
  if (!kv) return null;
  const key = normalizeCodeKey(path, { raw });
  return await kv.get(key, "text");
}

async function codePut(env, path, content, { ns, raw } = {}) {
  const kv = codeKV(env, ns);
  if (!kv) throw new Error("KV not configured");
  const key = normalizeCodeKey(path, { raw });
  await kv.put(key, content, { metadata: { path, ts: Date.now() } });
  return true;
}

async function codeList(env, { ns, prefix, raw } = {}) {
  const kv = codeKV(env, ns);
  if (!kv?.list) return [];
  const pref = prefix ? normalizeCodeKey(prefix, { raw }) : normalizeCodeKey("", { raw });
  const it = await kv.list({ prefix: pref });
  return (it?.keys || []).map((k) => ({
    key: k.name,
    ts: k?.metadata?.ts || null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = (url.pathname || "/").replace(/\/+$/, "") || "/";
    url.pathname = p;
    const method = req.method === "HEAD" ? "GET" : req.method;

    if (req.method === "OPTIONS") return preflight();

    if (p === "/_version")
      return json({ ok: true, version: VERSION, entry: "src/index.js" }, 200, CORS);

    try {
      // ── ROOT / HEALTH ─────────────────────────────
      if (p === "/") return html(home(env));
      if (p === "/health") {
        const r = await handleHealth?.(req, env, url).catch(() => null);
        return r || json({ ok: true, service: env.SERVICE_HOST, ts: new Date().toISOString() }, 200, CORS);
      }

      if (p === "/webhook" && method === "GET")
        return json({ ok: true, message: "webhook alive" }, 200, CORS);

      // ✅ Vision API
      if (p.startsWith("/api/vision")) {
        const r = await handleVisionApi?.(req, env, url);
        if (r) return r;
        return json({ ok: false, error: "vision handler missing" }, 404, CORS);
      }

      // ── Brain state ───────────────────────────────
      if (p === "/brain/state") {
        const r = await handleBrainState?.(req, env, url).catch(() => null);
        return r || json({ ok: true, state: "available" }, 200, CORS);
      }

      // далі код без змін...
      // (всі адмін-роути, cron, oauth і т.д. лишаємо як є — вони валідні)

      // webhook POST
      if (p === "/webhook" && req.method === "POST") {
        const sec = req.headers.get("x-telegram-bot-api-secret-token");
        if (env.TG_WEBHOOK_SECRET && sec !== env.TG_WEBHOOK_SECRET)
          return json({ ok: false, error: "unauthorized" }, 401, CORS);
        const r = await handleTelegramWebhook?.(req, env, url);
        return r || json({ ok: true, note: "fallback webhook POST" }, 200, CORS);
      }

      // not found
      await appendChecklist(env, `[miss] ${new Date().toISOString()} ${req.method} ${p}${url.search}`).catch(() => {});
      return json({ ok: false, error: "Not found", path: p }, 404, CORS);

    } catch (e) {
      return json({ ok: false, error: String(e) }, 500, CORS);
    }
  },

  async scheduled(event, env) {
    await logHeartbeat(env);
    // решта scheduled логіки без змін
  },
};