// src/index.js — Cloudflare Workers entrypoint (router + Learn admin + cron)

import { handleTelegramWebhook } from "./routes/webhook.js";
import {
  runLearnOnce,
  getLastSummary,
  listQueued,
  enqueueLearn,
  getRecentInsights,
} from "./lib/kvLearnQueue.js";

// ✅ підключаємо чекліст-роути
import { handleAdminChecklist } from "./routes/adminChecklist.js";
import { handleAdminChecklistWithEnergy } from "./routes/adminChecklistWrap.js";

// ── helpers ──────────────────────────────────────────────────────────────────
function secFromEnv(env) {
  return (
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    ""
  );
}
function isAuthed(url, env) {
  const s = url.searchParams.get("s") || "";
  const exp = secFromEnv(env);
  return !!exp && s === exp;
}
function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}
function html(markup, init = {}) {
  return new Response(String(markup || ""), {
    status: init.status || 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}
function notFound() {
  return json({ ok: false, error: "not_found" }, { status: 404 });
}
function unauthorized() {
  return json({ ok: false, error: "unauthorized" }, { status: 401 });
}
function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ── Learn: tiny HTML UI ──────────────────────────────────────────────────────
async function learnHtml(env, url) {
  const last = await getLastSummary(env).catch(() => "");
  const queued = await listQueued(env, { limit: 50 }).catch(() => []);
  const insights = await getRecentInsights(env, { limit: 10 }).catch(() => []);

  const runUrl = (() => {
    url.searchParams.set("s", secFromEnv(env));
    const u = new URL(url);
    u.pathname = "/admin/learn/run";
    return u.toString();
  })();

  const css = `
  <style>
    body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:24px;max-width:960px;margin:0 auto;background:#0b0f14;color:#e6edf3}
    a{color:#8ab4f8;text-decoration:none}
    a:hover{text-decoration:underline}
    h1{font-size:22px;margin:0 0 16px}
    .card{background:#11161d;border:1px solid #1f2937;border-radius:12px;padding:16px;margin:12px 0}
    .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3}
    .btn:hover{background:#2a3f55}
    .muted{opacity:.8}
    code,pre{background:#0b1117;border:1px solid #1f2937;border-radius:10px;padding:10px;display:block;white-space:pre-wrap}
    ul{margin:0;padding-left:18px}
    li{margin:6px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .mono{font-family:ui-monospace,Consolas,Monaco,monospace}
    .tag{display:inline-block;font-size:12px;padding:2px 8px;border:1px solid #2d4f6b;border-radius:999px;margin-left:6px}
  </style>`;

  const queuedList = (queued && queued.length)
    ? `<ul>${queued
        .map(
          (q) =>
            `<li><span class="mono">${esc(q.kind)}</span> — ${esc(
              q?.payload?.name || q?.payload?.url || "item"
            )} <span class="muted mono">(${esc(q.at)})</span></li>`
        )
        .join("")}</ul>`
    : `<p class="muted">Черга порожня.</p>`;

  const insightsList = (insights && insights.length)
    ? `<ul>${insights
        .map(
          (i) =>
            `<li>${esc(i.insight || "")}${
              i.r2TxtKey || i.r2JsonKey || i.r2RawKey
                ? `<span class="tag">R2</span>`
                : ""
            }</li>`
        )
        .join("")}</ul>`
    : `<p class="muted">Ще немає збережених знань.</p>`;

  const body = `
    ${css}
    <h1>🧠 Senti Learn — статус</h1>

    <div class="card">
      <b>Останній підсумок</b>
      <pre>${esc(last || "—")}</pre>
      <a class="btn" href="${esc(runUrl)}">▶️ Запустити навчання зараз</a>
    </div>

    <div class="grid">
      <div class="card">
        <b>Черга</b>
        ${queuedList}
      </div>
      <div class="card">
        <b>Нещодавні знання (для System Prompt)</b>
        ${insightsList}
      </div>
    </div>

    <div class="card">
      <b>Додати в чергу</b>
      <form method="post" action="/admin/learn/enqueue?s=${esc(secFromEnv(env))}">
        <p><input name="url" placeholder="https://посилання або прямий файл" style="width:100%;padding:10px;border-radius:8px;border:1px solid #2d4f6b;background:#0b1117;color:#e6edf3"/></p>
        <p><input name="name" placeholder="Опційно: назва" style="width:100%;padding:10px;border-radius:8px;border:1px solid #2d4f6b;background:#0b1117;color:#e6edf3"/></p>
        <p><textarea name="text" rows="6" placeholder="Або встав тут текст, який треба вивчити" style="width:100%;padding:10px;border-radius:8px;border:1px solid #2d4f6b;background:#0b1117;color:#e6edf3"></textarea></p>
        <p><button class="btn" type="submit">＋ Додати</button></p>
      </form>
      <p class="muted">Підтримуються: статті/сторінки, YouTube (коли є транскрипт), PDF/TXT/MD/ZIP та ін.</p>
    </div>
  `;
  return html(body);
}

// ── Router ───────────────────────────────────────────────────────────────────
async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;

  // Health
  if (req.method === "GET" && (p === "/" || p === "/health")) {
    return json({ ok: true, name: "Senti", env: "workers", time: new Date().toISOString() });
  }

  // Telegram webhook (support both /webhook and /tg/webhook)
  if (p === "/webhook" || p === "/tg/webhook") {
    return handleTelegramWebhook(req, env);
  }

  // ✅ Checklist HTML / API
  if (p.startsWith("/admin/checklist")) {
    const handled = await handleAdminChecklist(req, env, url);
    if (handled) return handled;
  }

  // ✅ Wrapper: Checklist + Energy (iframe)
  if (req.method === "GET" && p === "/admin/checklist/with-energy/html") {
    return handleAdminChecklistWithEnergy(req, env, url);
  }

  // Learn Admin: HTML
  if (req.method === "GET" && p === "/admin/learn/html") {
    if (!isAuthed(url, env)) return unauthorized();
    return learnHtml(env, url);
  }

  // Learn Admin: run once (GET for browser / POST for API)
  if ((req.method === "GET" || req.method === "POST") && p === "/admin/learn/run") {
    if (!isAuthed(url, env)) return unauthorized();
    try {
      const out = await runLearnOnce(env, { maxItems: Number(url.searchParams.get("n") || 10) });
      if (req.method === "GET") {
        const back = (() => {
          const u = new URL(url);
          u.pathname = "/admin/learn/html";
          return u.toString();
        })();
        return html(`
          <pre>${esc(out.summary || JSON.stringify(out, null, 2))}</pre>
          <p><a href="${esc(back)}">← Назад</a></p>
        `);
      }
      return json(out);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  }

  // Learn Admin: enqueue (POST form or JSON)
  if (req.method === "POST" && p === "/admin/learn/enqueue") {
    if (!isAuthed(url, env)) return unauthorized();
    let body = {};
    const ctype = req.headers.get("content-type") || "";
    try {
      if (ctype.includes("application/json")) {
        body = await req.json();
      } else if (ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data")) {
        const form = await req.formData();
        body = Object.fromEntries(form.entries());
      } else {
        body = {};
      }
    } catch {
      body = {};
    }

    const userId = url.searchParams.get("u") || "admin";
    const hasText = body?.text && String(body.text).trim().length > 0;
    const hasUrl = body?.url && String(body.url).startsWith("http");

    if (!hasText && !hasUrl) {
      return json({ ok: false, error: "provide url or text" }, { status: 400 });
    }

    if (hasText) {
      await enqueueLearn(env, userId, {
        text: String(body.text),
        name: body?.name || "inline-text",
      });
    }
    if (hasUrl) {
      await enqueueLearn(env, userId, {
        url: String(body.url),
        name: body?.name || String(body.url),
      });
    }

    if (!ctype.includes("application/json")) {
      const back = new URL(url);
      back.pathname = "/admin/learn/html";
      return Response.redirect(back.toString(), 303);
    }
    return json({ ok: true });
  }

  // Learn Admin: JSON status (for tooling)
  if (req.method === "GET" && p === "/admin/learn/status") {
    if (!isAuthed(url, env)) return unauthorized();
    try {
      const last = await getLastSummary(env);
      const queued = await listQueued(env, { limit: 50 });
      const insights = await getRecentInsights(env, { limit: 10 });
      return json({ ok: true, last, queued, insights });
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  }

  return notFound();
}

// ── Worker exports ───────────────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  },

  // Нічний агент: запуск навчання за розкладом (створи CRON trigger у Workers)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runLearnOnce(env, { maxItems: 12 }).catch(() => null));
  },
};