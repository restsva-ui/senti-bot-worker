// src/index.js — маршрути: Telegram, Learn, Checklist, Energy, Repo, Статут

import { handleTelegramWebhook } from "./routes/webhook.js";
import { handleAdminChecklist } from "./routes/adminChecklist.js";
import { handleAdminChecklistWithEnergy } from "./routes/adminChecklistWrap.js";
import { handleAdminEnergy } from "./routes/adminEnergy.js";

import {
  runLearnOnce,
  getLastSummary,
  listQueued,
  enqueueLearn,
  getRecentInsights,
} from "./lib/kvLearnQueue.js";

import { repoHtml, statutHtml, logChecklist } from "./lib/kvChecklist.js";

// ── helpers ──────────────────────────────────────────────────────────────────
function secFromEnv(env) {
  return env.WEBHOOK_SECRET || env.TG_WEBHOOK_SECRET || env.TELEGRAM_SECRET_TOKEN || "";
}
function isAuthed(url, env) {
  const s = url.searchParams.get("s") || "";
  const exp = secFromEnv(env);
  return !!exp && s === exp;
}
function json(data, init = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status: init.status || 200,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}
function html(markup, init = {}) {
  return new Response(String(markup || ""), {
    status: init.status || 200,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers || {}) },
  });
}
function notFound() { return json({ ok: false, error: "not_found" }, { status: 404 }); }
function esc(s = "") { return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

// ── Learn HTML (мобільно-дружній; форма зверху; картки KV/R2) ───────────────
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

  const hasKV = !!env.LEARN_QUEUE_KV || !!env.STATE_KV;
  const hasR2 = !!env.LEARN_BUCKET;

  const css = `
  <style>
    :root{--bg:#0b0f14;--panel:#11161d;--border:#1f2937;--txt:#e6edf3;--muted:#9aa7b2;--btn:#223449;--btnb:#2d4f6b}
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--txt);margin:0}
    .wrap{max-width:980px;margin:0 auto;padding:12px}
    .row{display:flex;gap:8px;flex-wrap:wrap}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;background:var(--btn);border:1px solid var(--btnb);color:var(--txt);text-decoration:none}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px;margin:10px 0}
    .grid{display:grid;grid-template-columns:1fr;gap:12px}
    @media(min-width:820px){.grid{grid-template-columns:1fr 1fr}}
    input,textarea{width:100%;padding:10px;border-radius:8px;border:1px solid var(--btnb);background:#0b1117;color:var(--txt)}
    ul{margin:0;padding-left:18px}
    .muted{color:var(--muted)}
    .ok{color:#34d399} .bad{color:#f87171}
  </style>`;

  const queuedList = queued.length
    ? `<ul>${queued.map(q => `<li><span class="muted">${esc(q.kind)}</span> — ${esc(q?.payload?.name || q?.payload?.url || "item")} <span class="muted">(${esc(q.at)})</span></li>`).join("")}</ul>`
    : `<p class="muted">Черга порожня.</p>`;

  const insightsList = insights.length
    ? `<ul>${insights.map(i => `<li>${esc(i.insight || "")}${(i.r2TxtKey || i.r2JsonKey || i.r2RawKey) ? ` <span class="muted">[R2]</span>` : ""}</li>`).join("")}</ul>`
    : `<p class="muted">Ще немає збережених знань.</p>`;

  const body = `
    ${css}
    <div class="wrap">
      <div class="row" style="margin-bottom:10px">
        <a class="btn" href="${esc(runUrl)}">▶️ Запустити</a>
        <a class="btn" href="/admin/checklist/html?s=${encodeURIComponent(secFromEnv(env))}">📝 Checklist</a>
        <a class="btn" href="/admin/energy/html">⚡ Energy</a>
      </div>

      <div class="card">
        <b>Додати в чергу</b>
        <form method="post" action="/admin/learn/enqueue?s=${esc(secFromEnv(env))}">
          <p><input name="url" placeholder="https://посилання або прямий файл"/></p>
          <p><input name="name" placeholder="Опційно: назва"/></p>
          <p><textarea name="text" rows="6" placeholder="Або встав тут текст, який треба вивчити"></textarea></p>
          <p><button class="btn" type="submit">＋ Додати</button></p>
        </form>
        <p class="muted">Підтримуються: статті/сторінки, YouTube (коли є транскрипт), PDF/TXT/MD/ZIP тощо.</p>
      </div>

      <div class="grid">
        <div class="card">
          <b>Пам'ять KV</b><div class="${hasKV ? "ok":"bad"}">${hasKV ? "Стан: під’єднано ✅" : "Стан: не знайдено ❌"}</div>
          <p class="muted">Використовується для черги Learn, чекліста, інсайтів. <a href="/admin/checklist/html?s=${encodeURIComponent(secFromEnv(env))}">Відкрити</a></p>
        </div>
        <div class="card">
          <b>R2 Storage</b><div class="${hasR2 ? "ok":"bad"}">${hasR2 ? "Стан: під’єднано ✅" : "Стан: не знайдено ❌"}</div>
          <p class="muted">Зберігаємо великі файли: оригінали, очищені тексти, JSON-індекси. <a href="/admin/repo/html">Відкрити Repo</a></p>
        </div>
      </div>

      <div class="card">
        <b>Останній підсумок</b>
        <pre style="white-space:pre-wrap;background:#0b1117;border:1px solid #1f2937;border-radius:10px;padding:10px">${esc(last || "—")}</pre>
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
    </div>`;
  return html(body);
}

// ── Router ───────────────────────────────────────────────────────────────────
async function route(req, env, ctx) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (req.method === "GET" && (p === "/" || p === "/health")) {
    return json({ ok: true, name: "Senti", env: "workers", time: new Date().toISOString() });
  }

  if (p === "/webhook" || p === "/tg/webhook") {
    return handleTelegramWebhook(req, env);
  }

  // Learn Admin
  if (req.method === "GET" && p === "/admin/learn/html") {
    if (!isAuthed(url, env)) return json({ ok:false, error:"unauthorized" }, { status:401 });
    return learnHtml(env, url);
  }
  if ((req.method === "GET" || req.method === "POST") && p === "/admin/learn/run") {
    if (!isAuthed(url, env)) return json({ ok:false, error:"unauthorized" }, { status:401 });
    const out = await runLearnOnce(env, { maxItems: Number(url.searchParams.get("n") || 10) }).catch(e => ({ ok:false, error:String(e?.message||e) }));
    if (req.method === "GET") {
      const back = (() => { const u = new URL(url); u.pathname = "/admin/learn/html"; return u.toString(); })();
      return html(`<pre>${esc(out.summary || JSON.stringify(out, null, 2))}</pre><p><a href="${esc(back)}">← Назад</a></p>`);
    }
    return json(out);
  }
  if (req.method === "POST" && p === "/admin/learn/enqueue") {
    if (!isAuthed(url, env)) return json({ ok:false, error:"unauthorized" }, { status:401 });
    let body = {}; const ctype = req.headers.get("content-type") || "";
    try {
      if (ctype.includes("application/json")) body = await req.json();
      else if (ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data")) body = Object.fromEntries((await req.formData()).entries());
    } catch {}
    const userId = url.searchParams.get("u") || "admin";
    const hasText = body?.text && String(body.text).trim().length > 0;
    const hasUrl = body?.url && String(body.url).startsWith("http");
    if (!hasText && !hasUrl) return json({ ok:false, error:"provide url or text" }, { status:400 });
    if (hasText) await enqueueLearn(env, userId, { text: String(body.text), name: body?.name || "inline-text" });
    if (hasUrl)  await enqueueLearn(env, userId, { url:  String(body.url),  name: body?.name || String(body.url) });

    if (!ctype.includes("application/json")) {
      const back = new URL(url); back.pathname = "/admin/learn/html";
      return Response.redirect(back.toString(), 303);
    }
    return json({ ok:true });
  }
  if (req.method === "GET" && p === "/admin/learn/status") {
    if (!isAuthed(url, env)) return json({ ok:false, error:"unauthorized" }, { status:401 });
    const [last, queued, insights] = await Promise.all([
      getLastSummary(env).catch(()=>""), listQueued(env, {limit:50}).catch(()=>[]), getRecentInsights(env, {limit:10}).catch(()=>[])
    ]);
    return json({ ok:true, last, queued, insights });
  }

  // Checklist (GET/POST) + wrapper з енергією
  const resChecklist = await handleAdminChecklist(req, env, url);
  if (resChecklist) return resChecklist;
  if (req.method === "GET" && p === "/admin/checklist/html") {
    return (await import("./lib/kvChecklist.js")).then(m => html(await m.checklistHtml(env)));
  }
  if (req.method === "GET" && p === "/admin/checklist/with-energy/html") {
    return handleAdminChecklistWithEnergy(req, env, url);
  }

  // Energy
  const resEnergy = await handleAdminEnergy(req, env, url);
  if (resEnergy) return resEnergy;

  // Repo / Статут (без секрету, як у 1.8)
  if (req.method === "GET" && p === "/admin/repo/html")   return html(await repoHtml(env));
  if (req.method === "GET" && p === "/admin/statut/html") return html(await statutHtml(env));

  return notFound();
}

// ── Worker exports ───────────────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
    try { return await route(req, env, ctx); }
    catch (e) { return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
  },

  async scheduled(event, env, ctx) {
    // лог хартбіта (як у 1.8)
    ctx.waitUntil(logChecklist(env, "heartbeat cron").catch(()=>null));

    // щогодини — невеликий батч
    ctx.waitUntil(runLearnOnce(env, { maxItems: 12 }).catch(() => null));
  },
};