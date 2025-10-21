// src/index.js — Cloudflare Workers entrypoint (router + Learn admin + cron)

import { handleTelegramWebhook } from "./routes/webhook.js";
import {
  runLearnOnce,
  getLastSummary,
  listQueued,
  enqueueLearn,
  getRecentInsights,
} from "./lib/kvLearnQueue.js";

// Checklist routes
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
function hostOf(u = "") {
  try { return new URL(u).host; } catch { return ""; }
}
function since(iso) {
  const t = Date.parse(iso || "");
  if (!t) return "";
  const sec = Math.max(1, Math.floor((Date.now() - t) / 1000));
  const units = [
    ["д", 86400],
    ["год", 3600],
    ["хв", 60],
    ["с", 1],
  ];
  for (const [lbl, s] of units) {
    if (sec >= s) return `${Math.floor(sec / s)} ${lbl} тому`;
  }
  return "щойно";
}

// ── Learn: HTML UI (перероблено) ─────────────────────────────────────────────
async function learnHtml(env, url) {
  const last = await getLastSummary(env).catch(() => "");
  const queued = await listQueued(env, { limit: 200 }).catch(() => []);
  const insights = await getRecentInsights(env, { limit: 50 }).catch(() => []);

  const runUrl = (() => {
    url.searchParams.set("s", secFromEnv(env));
    const u = new URL(url);
    u.pathname = "/admin/learn/run";
    return u.toString();
  })();

  const css = `
  <style>
    :root{
      --bg:#0b0f14; --card:#11161d; --muted:#9fb0c2; --border:#1f2937;
      --btn:#223449; --btn2:#2a3f55; --txt:#e6edf3; --pill:#263445;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    }
    *{box-sizing:border-box}
    body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:var(--bg);color:var(--txt)}
    a{color:#8ab4f8;text-decoration:none} a:hover{text-decoration:underline}
    header{position:sticky;top:0;background:rgba(11,15,20,.85);backdrop-filter:blur(6px);
      border-bottom:1px solid var(--border);z-index:10}
    .bar{max-width:1080px;margin:0 auto;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px}
    .wrap{max-width:1080px;margin:0 auto;padding:16px}
    h1{margin:0;font-size:18px}
    .btn{display:inline-flex;gap:8px;align-items:center;padding:10px 14px;border-radius:10px;background:var(--btn);border:1px solid var(--border);color:var(--txt)}
    .btn:hover{background:var(--btn2)}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px}
    .muted{color:var(--muted)}
    pre{white-space:pre-wrap;background:#0b1117;border:1px solid var(--border);border-radius:10px;padding:12px}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
    th{color:var(--muted);font-weight:600;text-align:left}
    .mono{font-family:var(--mono)}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--pill);font-size:12px;margin-left:6px}
    input,textarea{width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:#0b1117;color:var(--txt)}
    .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  </style>`;

  const queuedTable = (queued && queued.length)
    ? `
      <table>
        <thead>
          <tr>
            <th>Коли</th>
            <th>Тип</th>
            <th>Назва / Посилання</th>
          </tr>
        </thead>
        <tbody>
          ${queued.map(q => {
            const when = esc(q.at || "");
            const kind = esc(q.kind || "");
            const name = esc(q?.payload?.name || "");
            const urlStr = q?.payload?.url ? String(q.payload.url) : "";
            const link = urlStr
              ? `<a href="${esc(urlStr)}" target="_blank">${esc(name || hostOf(urlStr) || urlStr)}</a> <span class="muted mono">(${esc(hostOf(urlStr))})</span>`
              : `<span class="mono">${name || "(текст)"}</span>`;
            return `<tr>
              <td class="muted" title="${esc(when)}">${esc(since(when))}</td>
              <td><span class="mono">${kind}</span></td>
              <td>${link}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `
    : `<p class="muted">Черга порожня.</p>`;

  const insightsList = (insights && insights.length)
    ? `<ul style="margin:0;padding-left:18px">
        ${insights.map(i => `<li>${esc(i.insight || "")}${(i.r2TxtKey||i.r2JsonKey||i.r2RawKey)?'<span class="pill">R2</span>':''}</li>`).join("")}
      </ul>`
    : `<p class="muted">Ще немає збережених знань.</p>`;

  const body = `
    ${css}
    <header>
      <div class="bar">
        <h1>🧠 Senti Learn</h1>
        <div class="row">
          <a class="btn" href="${esc(runUrl)}">▶️ Запустити навчання зараз</a>
          <a class="btn" href="/admin/checklist/html?s=${esc(secFromEnv(env))}" target="_blank">📝 Checklist</a>
          <a class="btn" href="/admin/energy/html?s=${esc(secFromEnv(env))}" target="_blank">⚡ Energy</a>
        </div>
      </div>
    </header>

    <div class="wrap">
      <div class="card">
        <b>Останній підсумок</b>
        <pre>${esc(last || "—")}</pre>
      </div>

      <div class="grid">
        <div class="card">
          <div class="row" style="justify-content:space-between">
            <b>Черга</b>
            <span class="muted">${queued.length} елем.</span>
          </div>
          ${queuedTable}
        </div>

        <div class="card">
          <b>Нещодавні знання (для System Prompt)</b>
          ${insightsList}
        </div>
      </div>

      <div class="card">
        <b>Додати в чергу</b>
        <form method="post" action="/admin/learn/enqueue?s=${esc(secFromEnv(env))}">
          <p><input name="url" placeholder="https://посилання або прямий файл"/></p>
          <p><input name="name" placeholder="Опційно: назва"/></p>
          <p><textarea name="text" rows="6" placeholder="Або встав тут текст, який треба вивчити"></textarea></p>
          <p><button class="btn" type="submit">＋ Додати</button></p>
        </form>
        <p class="muted">Підтримуються: статті/сторінки, YouTube (коли є транскрипт), PDF/TXT/MD/ZIP та ін.</p>
      </div>
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

  // Checklist HTML/API
  if (p.startsWith("/admin/checklist")) {
    const handled = await handleAdminChecklist(req, env, url);
    if (handled) return handled;
  }

  // Wrapper: Checklist + Energy (iframe)
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
    const hasUrl  = body?.url && String(body.url).startsWith("http");

    if (!hasText && !hasUrl) {
      return json({ ok: false, error: "provide url or text" }, { status: 400 });
    }

    if (hasText) {
      await enqueueLearn(env, userId, { text: String(body.text), name: body?.name || "inline-text" });
    }
    if (hasUrl) {
      await enqueueLearn(env, userId, { url: String(body.url),  name: body?.name || String(body.url) });
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