// src/index.js — Cloudflare Workers entrypoint (router + Learn admin + cron)

import { handleTelegramWebhook } from "./routes/webhook.js";
import { handleAdminChecklist } from "./routes/adminChecklist.js";
import { handleAdminChecklistWithEnergy } from "./routes/adminChecklistWrap.js";

import {
  runLearnOnce,
  getLastSummary,
  listQueued,
  enqueueLearn,
  getRecentInsights,
} from "./lib/kvLearnQueue.js";

import { getEnergy } from "./lib/energy.js";

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
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
function hostOf(u = "") {
  try { return new URL(u).host; } catch { return ""; }
}
function since(iso) {
  const t = Date.parse(iso || ""); if (!t) return "";
  const sec = Math.max(1, Math.floor((Date.now() - t) / 1000));
  const L = [["д",86400],["год",3600],["хв",60],["с",1]];
  for (const [lbl,s] of L) if (sec >= s) return `${Math.floor(sec/s)} ${lbl} тому`;
  return "щойно";
}

// ── Energy HTML (адаптивний віджет) ──────────────────────────────────────────
async function energyHtml(env, url) {
  const uid = url.searchParams.get("u") || env.TELEGRAM_ADMIN_ID || "admin";
  const data = await getEnergy(env, uid).catch(() => ({}));

  const css = `
  <style>
    :root{--bg:#0b0f14;--card:#11161d;--border:#1f2937;--txt:#e6edf3;--muted:#9fb0c2}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.4 system-ui,Segoe UI,Roboto,sans-serif}
    .wrap{max-width:720px;margin:0 auto;padding:16px}
    .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .k{color:var(--muted)}
    .mono{font-family:ui-monospace,Consolas,Menlo,monospace}
    @media (max-width:760px){ .grid{grid-template-columns:1fr} body{font-size:15px} }
  </style>`;
  const body = `
    ${css}
    <div class="wrap">
      <div class="card">
        <h3 style="margin:6px 0">⚡ Energy</h3>
        <div class="grid">
          <div><div class="k">User</div><div class="mono">${esc(String(uid))}</div></div>
          <div><div class="k">Balance</div><b>${esc(String(data.energy ?? "—"))}</b></div>
          <div><div class="k">Cost (text)</div><div>${esc(String(data.costText ?? "1"))}</div></div>
          <div><div class="k">Cost (image)</div><div>${esc(String(data.costImage ?? "5"))}</div></div>
        </div>
        <p class="k" style="margin-top:10px">Поповнення/налаштування — через API/адмін-інтерфейси.</p>
      </div>
    </div>`;
  return html(body);
}

// ── Learn: мобільний HTML UI з R2/KV блоками ────────────────────────────────
async function learnHtml(env, url) {
  const last = await getLastSummary(env).catch(() => "");
  const queued = await listQueued(env, { limit: 200 }).catch(() => []);
  const insights = await getRecentInsights(env, { limit: 50 }).catch(() => []);

  const runUrl = (() => {
    url.searchParams.set("s", secFromEnv(env));
    const u = new URL(url); u.pathname = "/admin/learn/run"; return u.toString();
  })();

  const hasKV = !!env.STATE_KV || !!env.KV || !!env.CHECKLIST_KV;
  const hasR2 = !!env.R2 || !!env.ASSETS || !!env.BUCKET;

  const css = `
  <style>
    :root{
      --bg:#0b0f14;--card:#11161d;--muted:#9fb0c2;--border:#1f2937;--btn:#223449;--btn2:#2a3f55;--txt:#e6edf3;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    }
    *{box-sizing:border-box}
    body{font:15px/1.45 ui-sans-serif,system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:var(--bg);color:var(--txt)}
    a{color:#8ab4f8;text-decoration:none}
    a:hover{text-decoration:underline}
    header{position:sticky;top:0;background:rgba(11,15,20,.85);backdrop-filter:blur(6px);border-bottom:1px solid var(--border);z-index:10}
    .bar{max-width:1080px;margin:0 auto;display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px}
    .wrap{max-width:1080px;margin:0 auto;padding:12px}
    h1{margin:0;font-size:18px}
    .btn{display:inline-flex;gap:8px;align-items:center;padding:8px 12px;border-radius:10px;background:var(--btn);border:1px solid var(--border);color:var(--txt)}
    .btn:hover{background:var(--btn2)}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px}
    .muted{color:var(--muted)}
    pre{white-space:pre-wrap;background:#0b1117;border:1px solid var(--border);border-radius:10px;padding:10px;margin:0;word-break:break-word}
    table{width:100%;border-collapse:collapse;font-size:14px}
    th,td{padding:8px;border-bottom:1px solid var(--border);vertical-align:top}
    th{text-align:left;color:var(--muted)}
    .mono{font-family:var(--mono)}
    .pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#263445;font-size:12px;margin-left:6px}
    input,textarea{width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:#0b1117;color:var(--txt)}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    li{line-height:1.35;word-break:break-word}
    @media (max-width: 820px){
      .grid{grid-template-columns:1fr}
      table{font-size:15px}
      .bar{padding:8px}
      .btn{padding:8px 10px}
      body{font-size:16px}
    }
  </style>`;

  const queuedTable = queued.length
    ? `<table>
        <thead><tr><th>Коли</th><th>Тип</th><th>Назва / Посилання</th></tr></thead>
        <tbody>
          ${queued.map(q=>{
            const when = esc(q.at||"");
            const kind = esc(q.kind||"");
            const name = esc(q?.payload?.name || "");
            const urlStr = q?.payload?.url ? String(q.payload.url) : "";
            const link = urlStr
              ? `<a href="${esc(urlStr)}" target="_blank">${esc(name || hostOf(urlStr) || urlStr)}</a> <span class="muted mono">(${esc(hostOf(urlStr))})</span>`
              : `<span class="mono">${esc(name || "(текст)")}</span>`;
            return `<tr>
              <td class="muted" title="${esc(when)}">${esc(since(when))}</td>
              <td><span class="mono">${kind}</span></td>
              <td>${link}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`
    : `<p class="muted">Черга порожня.</p>`;

  const insightsList = insights.length
    ? `<ul style="margin:0;padding-left:18px">${insights.map(i =>
        `<li>${esc(i.insight || "")}${(i.r2TxtKey||i.r2JsonKey||i.r2RawKey)?'<span class="pill">R2</span>':''}</li>`).join("")}
      </ul>`
    : `<p class="muted">Ще немає збережених знань.</p>`;

  const storageBlock = `
    <div class="grid">
      <div class="card">
        <b>Пам'ять KV</b>
        <p class="muted" style="margin:.4rem 0">${hasKV ? "Стан: під’єднано ✅" : "Стан: не знайдено ❌"}</p>
        <p class="muted">Використовується для: черги Learn, чекліста, інсайтів.</p>
      </div>
      <div class="card">
        <b>R2 Storage</b>
        <p class="muted" style="margin:.4rem 0">${hasR2 ? "Стан: під’єднано ✅" : "Стан: не знайдено ❌"}</p>
        <p class="muted">Зберігаємо великі файли: оригінали, очищені тексти, JSON-індекси.</p>
      </div>
    </div>`;

  const body = `
    ${css}
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <header>
      <div class="bar">
        <h1>🧠 Senti Learn</h1>
        <div class="row">
          <a class="btn" href="${esc(runUrl)}">▶️ Запустити</a>
          <a class="btn" href="/admin/checklist/html?s=${esc(secFromEnv(env))}" target="_blank">📝 Checklist</a>
          <a class="btn" href="/admin/energy/html?s=${esc(secFromEnv(env))}" target="_blank">⚡ Energy</a>
        </div>
      </div>
    </header>

    <div class="wrap">
      ${storageBlock}

      <div class="card" style="margin-top:12px">
        <b>Останній підсумок</b>
        <pre>${esc(last || "—")}</pre>
      </div>

      <div class="grid" style="margin-top:12px">
        <div class="card">
          <div class="row" style="justify-content:space-between">
            <b>Черга</b><span class="muted">${queued.length} елем.</span>
          </div>
          ${queuedTable}
        </div>

        <div class="card">
          <b>Нещодавні знання (для System Prompt)</b>
          ${insightsList}
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <b>Додати в чергу</b>
        <form method="post" action="/admin/learn/enqueue?s=${esc(secFromEnv(env))}">
          <p><input name="url" placeholder="https://посилання або прямий файл"/></p>
          <p><input name="name" placeholder="Опційно: назва"/></p>
          <p><textarea name="text" rows="6" placeholder="Або встав тут текст, який треба вивчити"></textarea></p>
          <p><button class="btn" type="submit">＋ Додати</button></p>
        </form>
        <p class="muted">Підтримуються: статті/сторінки, YouTube (коли є транскрипт), PDF/TXT/MD/ZIP тощо.</p>
      </div>
    </div>`;
  return html(body);
}

// ── Прості сторінки для Repo/Statute (щоб не давали 404) ─────────────────────
function simpleLinkPage(title, href, fallbackMsg) {
  const css = `
  <style>
    body{margin:0;background:#0b0f14;color:#e6edf3;font:15px/1.45 system-ui,Segoe UI,Roboto,sans-serif}
    .wrap{max-width:860px;margin:0 auto;padding:18px}
    .card{background:#11161d;border:1px solid #1f2937;border-radius:12px;padding:14px}
    a.btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3;text-decoration:none}
    a.btn:hover{background:#2a3f55}
    .muted{opacity:.8}
  </style>`;
  const body = `
  ${css}
  <div class="wrap">
    <div class="card">
      <h3 style="margin:0 0 10px">${esc(title)}</h3>
      ${href ? `<p><a class="btn" target="_blank" href="${esc(href)}">Відкрити</a></p>` :
        `<p class="muted">${esc(fallbackMsg)}</p>`}
      <p><a class="btn" href="/admin/checklist/html?s=${esc(href ? "" : "")}">← До Checklist</a></p>
    </div>
  </div>`;
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

  // Checklist HTML/API (і html-аліас)
  if (p.startsWith("/admin/checklist")) {
    if (!isAuthed(url, env)) return unauthorized();
    const handled = await handleAdminChecklist(req, env, url);
    if (handled) return handled;
  }

  // Wrapper: Checklist + Energy (iframe)
  if (req.method === "GET" && p === "/admin/checklist/with-energy/html") {
    if (!isAuthed(url, env)) return unauthorized();
    return handleAdminChecklistWithEnergy(req, env, url);
  }

  // Energy HTML
  if (req.method === "GET" && p === "/admin/energy/html") {
    if (!isAuthed(url, env)) return unauthorized();
    return energyHtml(env, url);
  }

  // Repo / Statute link pages (кнопки з Checklist)
  if (req.method === "GET" && p === "/admin/repo/html") {
    if (!isAuthed(url, env)) return unauthorized();
    const href = env.REPO_URL || "";
    const msg = "REPO_URL не налаштовано в Environment. Додай REPO_URL (GitHub / R2-браузер) або зміни посилання в чеклісті.";
    return simpleLinkPage("📁 Repo", href, msg);
  }
  if (req.method === "GET" && p === "/admin/statut/html") {
    if (!isAuthed(url, env)) return unauthorized();
    const href = env.STATUTE_URL || "";
    const msg = "STATUTE_URL не налаштовано. Додай STATUTE_URL (наприклад, Google Doc) або зміни посилання в чеклісті.";
    return simpleLinkPage("📜 Статут", href, msg);
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
        const back = (() => { const u = new URL(url); u.pathname = "/admin/learn/html"; return u.toString(); })();
        return html(`<pre>${esc(out.summary || JSON.stringify(out, null, 2))}</pre><p><a href="${esc(back)}">← Назад</a></p>`);
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
    const ctype = (req.headers.get("content-type") || "").toLowerCase();
    try {
      if (ctype.includes("application/json")) {
        body = await req.json();
      } else if (ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data")) {
        const form = await req.formData(); body = Object.fromEntries(form.entries());
      } else { body = {}; }
    } catch { body = {}; }

    const userId = url.searchParams.get("u") || "admin";
    const hasText = body?.text && String(body.text).trim().length > 0;
    const hasUrl  = body?.url && String(body.url).startsWith("http");

    if (!hasText && !hasUrl) return json({ ok: false, error: "provide url or text" }, { status: 400 });

    if (hasText) await enqueueLearn(env, userId, { text: String(body.text), name: body?.name || "inline-text" });
    if (hasUrl)  await enqueueLearn(env, userId, { url: String(body.url),  name: body?.name || String(body.url) });

    if (!ctype.includes("application/json")) {
      const back = new URL(url); back.pathname = "/admin/learn/html"; return Response.redirect(back.toString(), 303);
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

  // Нічний агент: запуск навчання за розкладом
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runLearnOnce(env, { maxItems: 12 }).catch(() => null));
  },
};