// src/index.js — Cloudflare Workers entrypoint (router + Learn admin + public views)

import { handleTelegramWebhook } from "./routes/webhook.js";

import {
  runLearnOnce,
  getLastSummary,
  listQueued,
  enqueueLearn,
  getRecentInsights,
} from "./lib/kvLearnQueue.js";

import {
  checklistHtml,
  readChecklist, writeChecklist, appendChecklist, saveArchive,
  statutHtml,
  readStatut, writeStatut, appendStatut,
  repoHtml,
} from "./lib/kvChecklist.js";

// ⚡ Energy HTML (mobile-first, read-only UI)
import { handleAdminEnergy } from "./routes/adminEnergy.js";

/* ───────────────────────── helpers ───────────────────────── */

function secFromEnv(env) {
  return (
    env.WEBHOOK_SECRET ||
    env.TG_WEBHOOK_SECRET ||
    env.TELEGRAM_SECRET_TOKEN ||
    ""
  );
}

// • Якщо секрет не налаштований → вважаємо авторизованим (як “раніше”)
// • Інакше — потрібно передати ?s=<secret>
function isAuthed(url, env) {
  const exp = secFromEnv(env);
  if (!exp) return true;
  const s = url.searchParams.get("s") || "";
  return s === exp;
}

// allow public=1 to bypass secret for readonly pages (repo/statut/checklist-view)
// також дозволяємо без секрету, якщо ALLOW_PUBLIC_* = "on"
function wantPublic(url) {
  return (url.searchParams.get("public") || "").trim() === "1";
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
function text(txt, init = {}) {
  return new Response(String(txt || ""), {
    status: init.status || 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
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
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/* ─────────────────────── Learn HTML (mobile-first) ───────────────────────
   - форма додавання (url / text) — ЗВЕРХУ
   - статус черги
   - останній підсумок
   - інсайти
   - міні-виджети пам’яті (KV/R2) у вигляді бейджів-лічильників
   - посилання на /admin/repo/html і список learn/ у R2
------------------------------------------------------------------------- */
async function r2Count(env, prefix, limit = 500) {
  const b = env.LEARN_BUCKET;
  if (!b) return 0;
  let n = 0, cursor, guard = 0;
  try {
    do {
      const r = await b.list({ prefix, limit: Math.min(1000, limit), cursor });
      n += (r.objects || []).length;
      cursor = r.truncated ? r.cursor : undefined;
      guard++;
    } while (cursor && n < limit && guard < 20);
  } catch { /* ignore */ }
  return n;
}

async function learnHtml(env, url) {
  const last = await getLastSummary(env).catch(() => "");
  const queued = await listQueued(env, { limit: 100 }).catch(() => []);
  const insights = await getRecentInsights(env, { limit: 12 }).catch(() => []);

  // міні-виджети (best-effort; без дорогих операцій)
  const kvQueuedCount = Array.isArray(queued) ? queued.length : 0;
  const kvInsightsCount = Array.isArray(insights) ? insights.length : 0;
  const r2LearnCount = await r2Count(env, "learn/", 500).catch(() => 0);
  const r2RepoCount  = await r2Count(env, "repo/", 500).catch(() => 0);

  const runUrl = (() => {
    const u = new URL(url);
    u.pathname = "/admin/learn/run";
    u.searchParams.set("s", secFromEnv(env));
    return u.toString();
  })();

  const css = `
  <style>
    :root{color-scheme:dark}
    body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:#0b0f14;color:#e6edf3}
    a{color:#8ab4f8;text-decoration:none}
    a:hover{text-decoration:underline}
    .wrap{max-width:980px;margin:0 auto;padding:12px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .card{background:#11161d;border:1px solid #1f2937;border-radius:12px;padding:14px}
    .row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap}
    .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3}
    .btn:hover{background:#2a3f55}
    .muted{opacity:.8}
    input,textarea{width:100%;padding:10px;border-radius:10px;border:1px solid #2d4f6b;background:#0b1117;color:#e6edf3}
    textarea{min-height:120px}
    ul{margin:0;padding-left:18px}
    li{margin:6px 0}
    pre{white-space:pre-wrap;background:#0b1117;border:1px solid #1f2937;border-radius:10px;padding:10px}
    .badges{display:flex;gap:8px;flex-wrap:wrap}
    .badge{font-size:12px;padding:6px 10px;border-radius:999px;border:1px solid #2d4f6b;background:#0c1722;display:inline-flex;gap:6px;align-items:center}
    .badge b{font-variant-numeric:tabular-nums}
    .section-title{margin:0 0 8px}
    @media (max-width: 760px){ .grid{grid-template-columns:1fr} .wrap{padding:10px} }
  </style>`;

  const queuedList = kvQueuedCount
    ? `<ul>${queued.map(q =>
        `<li><span class="muted">${esc(q.kind)}</span> — ${esc(q?.payload?.name || q?.payload?.url || "item")} <span class="muted">(${esc(q.at)})</span></li>`
      ).join("")}</ul>`
    : `<p class="muted">Черга порожня.</p>`;

  const insightsList = kvInsightsCount
    ? `<ul>${insights.map(i =>
        `<li>${esc(i.insight || "")}${i.r2Key ? ` <span class="badge"><span>R2</span></span>` : ""}</li>`
      ).join("")}</ul>`
    : `<p class="muted">Ще немає збережених знань.</p>`;

  const r2Links = `
    <div class="badges">
      <a class="badge" href="/admin/repo/html?s=${encodeURIComponent(secFromEnv(env))}"><span>R2 Repo</span> <b>${r2RepoCount}</b></a>
      <a class="badge" href="/admin/learn/r2/html?s=${encodeURIComponent(secFromEnv(env))}"><span>R2 Learn</span> <b>${r2LearnCount}</b></a>
      <span class="badge"><span>KV Queue</span> <b>${kvQueuedCount}</b></span>
      <span class="badge"><span>KV Insights</span> <b>${kvInsightsCount}</b></span>
    </div>`;

  const body = `
    ${css}
    <div class="wrap">

      <div class="card row">
        <h1 class="section-title">🧠 Senti Learn</h1>
        <div class="row">
          <a class="btn" href="${esc(runUrl)}">▶️ Запустити навчання</a>
          <a class="btn" href="/admin/learn/html?s=${encodeURIComponent(secFromEnv(env))}">Оновити</a>
        </div>
      </div>

      <div class="card">
        <h3 class="section-title">Додати в чергу</h3>
        <form method="post" action="/admin/learn/enqueue?s=${encodeURIComponent(secFromEnv(env))}">
          <p><input name="url" type="url" inputmode="url" placeholder="https://посилання або прямий файл"/></p>
          <p><input name="name" type="text" placeholder="Опційно: назва"/></p>
          <p><textarea name="text" rows="6" placeholder="Або встав тут текст, який треба вивчити"></textarea></p>
          <p><button class="btn" type="submit">＋ Додати</button></p>
        </form>
        <p class="muted">Підтримуються: статті/сторінки, YouTube (мета), PDF/TXT/MD/ZIP, зображення/відео (як файли — йдуть у R2).</p>
      </div>

      <div class="card">
        <h3 class="section-title">Пам'ять</h3>
        ${r2Links}
      </div>

      <div class="grid">
        <div class="card">
          <h3 class="section-title">Черга</h3>
          ${queuedList}
        </div>
        <div class="card">
          <h3 class="section-title">Нещодавні знання</h3>
          ${insightsList}
        </div>
      </div>

      <div class="card">
        <h3 class="section-title">Останній підсумок</h3>
        <pre>${esc(last || "—")}</pre>
      </div>
    </div>
  `;
  return html(body);
}

/* ────────────── simple R2 listing for learn/ prefix (HTML) ────────────── */
async function learnR2Html(env) {
  const bucket = env.LEARN_BUCKET;
  const css = `
  <style>
    :root{color-scheme:dark}
    body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:#0b0f14;color:#e6edf3}
    .wrap{max-width:980px;margin:0 auto;padding:12px}
    .card{background:#11161d;border:1px solid #1f2937;border-radius:12px;padding:14px;margin:10px 0}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px;border-bottom:1px solid #1f2937}
    .mono{font-family:ui-monospace,Consolas,Menlo,monospace}
    .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3;text-decoration:none}
  </style>`;
  if (!bucket) {
    return html(`${css}<div class="wrap"><div class="card">R2 не прив’язано (LEARN_BUCKET).</div></div>`);
  }
  // List
  const items = [];
  let cursor, guard = 0;
  do {
    const r = await bucket.list({ prefix: "learn/", limit: 500, cursor });
    (r.objects || []).forEach(o => items.push(o));
    cursor = r.truncated ? r.cursor : undefined;
    guard++;
  } while (cursor && guard < 20);

  items.sort((a,b)=> (a.key < b.key ? 1 : -1));
  const rows = items.length
    ? items.map(o => `<tr>
        <td class="mono" style="word-break:break-all">${esc(o.key)}</td>
        <td>${(o.size||0).toLocaleString("uk-UA")} B</td>
        <td class="mono">${esc(o.uploaded || "")}</td>
      </tr>`).join("")
    : `<tr><td colspan="3" class="mono">Порожньо.</td></tr>`;

  return html(`${css}
  <div class="wrap">
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h2 style="margin:0">R2: learn/*</h2>
        <a class="btn" href="/admin/learn/r2/html?s=${encodeURIComponent(secFromEnv(env))}">Оновити</a>
      </div>
    </div>
    <div class="card">
      <div style="overflow:auto">
        <table>
          <thead><tr><th>Key</th><th>Size</th><th>Uploaded</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  </div>`);
}

/* ───────────────────────────── Router ───────────────────────────── */

async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;

  // Health
  if (req.method === "GET" && (p === "/" || p === "/health")) {
    return json({ ok: true, name: "Senti", env: "workers", time: new Date().toISOString() });
  }

  // Telegram webhook (both /webhook and /tg/webhook)
  if (p === "/webhook" || p === "/tg/webhook") {
    return handleTelegramWebhook(req, env);
  }

  /* ───────────── Energy (HTML) ───────────── */
  if (req.method === "GET" && p === "/admin/energy/html") {
    // energy — тільки за секретом або якщо секрет не налаштовано (isAuthed вже враховує)
    if (!isAuthed(url, env)) return unauthorized();
    return handleAdminEnergy(req, env, url);
  }

  /* ───────────── Learn Admin: HTML ───────────── */
  if (req.method === "GET" && p === "/admin/learn/html") {
    if (!isAuthed(url, env)) return unauthorized();
    return learnHtml(env, url);
  }

  /* Learn Admin: run once (GET for browser / POST for API) */
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
              <b>Підсумок</b>
              <pre>${esc(out.summary || JSON.stringify(out, null, 2))}</pre>
              <p><a class="btn" href="${esc(back)}">← Назад</a></p>
            </div>
          </div>
        `);
      }
      return json(out);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  }

  /* Learn Admin: enqueue (POST form or JSON) */
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
      }
    } catch { body = {}; }

    const userId = url.searchParams.get("u") || "admin";
    const hasText = body?.text && String(body.text).trim().length > 0;
    const hasUrl = body?.url && String(body.url).startsWith("http");

    if (!hasText && !hasUrl) {
      return json({ ok: false, error: "provide url or text" }, { status: 400 });
    }
    if (hasText) {
      await enqueueLearn(env, userId, { text: String(body.text), name: body?.name || "inline-text" });
    }
    if (hasUrl) {
      await enqueueLearn(env, userId, { url: String(body.url), name: body?.name || String(body.url) });
    }
    if (!ctype.includes("application/json")) {
      const back = new URL(url); back.pathname = "/admin/learn/html";
      return Response.redirect(back.toString(), 303);
    }
    return json({ ok: true });
  }

  /* Learn Admin: JSON status */
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

  /* Learn Admin: R2 list for learn/ */
  if (req.method === "GET" && p === "/admin/learn/r2/html") {
    if (!isAuthed(url, env)) return unauthorized();
    return learnR2Html(env);
  }

  /* ───────────── Checklist (HTML, GET) ─────────────
     - якщо public=1 → readonly версія (без секрету)
     - якщо без public:
         • якщо секрет НЕ налаштовано → пускаємо
         • інакше — потрібно ?s=<secret>
     - якщо ALLOW_PUBLIC_CHECKLIST="on" → readonly без секрету
  */
  if (req.method === "GET" && p === "/admin/checklist/html") {
    const allowAll = String(env.ALLOW_PUBLIC_CHECKLIST || "").toLowerCase() === "on";
    if (wantPublic(url) || allowAll) {
      const base = await checklistHtml(env);
      const stripped = base
        .replace(/<form[\s\S]*?<\/form>/gi, "")
        .replace(/<a class="btn"[^>]*>[^<]*Архівувати[\s\S]*?<\/a>/gi, "");
      return html(stripped);
    }
    if (!isAuthed(url, env)) return unauthorized();
    return html(await checklistHtml(env));
  }

  // Checklist actions (POST)
  if (req.method === "POST" && p === "/admin/checklist") {
    if (!isAuthed(url, env)) return unauthorized();
    const params = url.searchParams;
    const ct = req.headers.get("content-type") || "";
    let body = {};
    if (ct.includes("application/json")) {
      body = await req.json().catch(() => ({}));
    } else if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const f = await req.formData(); body = Object.fromEntries([...f.entries()]);
    } else {
      const textBody = await req.text().catch(() => "");
      if (textBody) { try { body = JSON.parse(textBody); } catch { body = { text: textBody }; } }
    }
    if (params.has("replace")) {
      await writeChecklist(env, body.text || "");
      const back = new URL(url); back.pathname = "/admin/checklist/html";
      return Response.redirect(back.toString(), 303);
    }
    if (params.has("append")) {
      await appendChecklist(env, body.line || body.text || "");
      const back = new URL(url); back.pathname = "/admin/checklist/html";
      return Response.redirect(back.toString(), 303);
    }
    if (params.has("archive")) {
      await saveArchive(env, "manual");
      const back = new URL(url); back.pathname = "/admin/checklist/html";
      return Response.redirect(back.toString(), 303);
    }
    return json({ ok: false, error: "unknown action" }, { status: 400 });
  }

  /* ───────────── Statut (HTML) ─────────────
     - public=1 → readonly
     - ALLOW_PUBLIC_STATUT="on" → readonly без секрету
     - інакше — секрет (або відсутність секрету в env допускається)
  */
  if (req.method === "GET" && p === "/admin/statut/html") {
    const allowAll = String(env.ALLOW_PUBLIC_STATUT || "").toLowerCase() === "on";
    if (wantPublic(url) || allowAll) {
      const base = await statutHtml(env);
      const stripped = base.replace(/<form[\s\S]*?<\/form>/gi, "");
      return html(stripped);
    }
    if (!isAuthed(url, env)) return unauthorized();
    return html(await statutHtml(env));
  }
  if (req.method === "POST" && p === "/admin/statut") {
    if (!isAuthed(url, env)) return unauthorized();
    const params = url.searchParams;
    const ct = req.headers.get("content-type") || "";
    let body = {};
    if (ct.includes("application/json")) {
      body = await req.json().catch(() => ({}));
    } else if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const f = await req.formData(); body = Object.fromEntries([...f.entries()]);
    } else {
      const textBody = await req.text().catch(() => "");
      if (textBody) { try { body = JSON.parse(textBody); } catch { body = { text: textBody }; } }
    }
    if (params.has("replace")) {
      await writeStatut(env, body.text || "");
      const back = new URL(url); back.pathname = "/admin/statut/html";
      return Response.redirect(back.toString(), 303);
    }
    if (params.has("append")) {
      await appendStatut(env, body.line || body.text || "");
      const back = new URL(url); back.pathname = "/admin/statut/html";
      return Response.redirect(back.toString(), 303);
    }
    return json({ ok: false, error: "unknown action" }, { status: 400 });
  }

  /* ───────────── Repo (R2) HTML ─────────────
     - public=1 або ALLOW_PUBLIC_REPO="on" → readonly без секрету
     - якщо секрет не налаштовано — теж пускаємо (як було раніше)
  */
  if (req.method === "GET" && p === "/admin/repo/html") {
    const allowAll = String(env.ALLOW_PUBLIC_REPO || "").toLowerCase() === "on";
    if (wantPublic(url) || allowAll || !secFromEnv(env)) {
      return html(await repoHtml(env));
    }
    if (!isAuthed(url, env)) return unauthorized();
    return html(await repoHtml(env));
  }

  return notFound();
}

/* ───────────────────── Worker exports ───────────────────── */

export default {
  async fetch(req, env, ctx) {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  },

  // Нічний агент: запуск навчання за розкладом (див. wrangler.toml triggers)
  async scheduled(event, env, ctx) {
    // невеликий батч; масштабуй за потреби
    ctx.waitUntil(runLearnOnce(env, { maxItems: 12 }).catch(() => null));
  },
};