// src/index.js — Cloudflare Workers router (webhook + Learn + Repo/Statut + Energy + cron)

import { handleTelegramWebhook } from "./routes/webhook.js";
import {
  runLearnOnce,
  getLastSummary,
  listQueued,
  enqueueLearn,
  getRecentInsights,
} from "./lib/kvLearnQueue.js";

import { checklistHtml, repoHtml, statutHtml } from "./lib/kvChecklist.js";
import { handleAdminChecklist } from "./routes/adminChecklist.js";
import { handleAdminChecklistWithEnergy } from "./routes/adminChecklistWrap.js";
import { handleAdminEnergy } from "./routes/adminEnergy.js";

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
function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

// ── R2/KV детектори для Learn ───────────────────────────────────────────────
function detectR2(env) {
  // підтримка кількох можливих імен біндінгів
  const candidates = [
    env.R2, env.BUCKET, env.STORAGE, env.SENTI_R2, env.R2_BUCKET, env.BLOB
  ].filter(Boolean);
  return candidates.length ? candidates[0] : null;
}
function detectKV(env) {
  const candidates = [
    env.KV, env.SENTI_KV, env.SENTI, env.SENTI_STORE, env.KV_NAMESPACE
  ].filter(Boolean);
  return candidates.length ? candidates[0] : null;
}

// ── Learn: responsive HTML UI ────────────────────────────────────────────────
async function learnHtml(env, url) {
  const last = await getLastSummary(env).catch(() => "");
  const queued = await listQueued(env, { limit: 50 }).catch(() => []);
  const insights = await getRecentInsights(env, { limit: 12 }).catch(() => []);

  const s = secFromEnv(env);
  const uWithS = (path) => {
    const u = new URL(url);
    u.pathname = path;
    if (s) u.searchParams.set("s", s);
    return u.toString();
  };

  const r2 = detectR2(env);
  const kv = detectKV(env);

  const css = `
  <style>
    :root{
      --bg:#0b0f14; --panel:#11161d; --muted:#9aa7b2; --border:#1f2937;
      --brand:#2a3f55; --btn:#223449; --btnb:#2d4f6b; --txt:#e6edf3;
    }
    *{box-sizing:border-box}
    body{font-family:ui-sans-serif,system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:0;background:var(--bg);color:var(--txt)}
    a{color:#8ab4f8;text-decoration:none}
    a:hover{text-decoration:underline}
    .wrap{max-width:980px;margin:0 auto;padding:16px}
    .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .h{display:flex;align-items:center;gap:12px;margin:6px 0 16px}
    .brand{font-weight:700;font-size:22px;display:flex;align-items:center;gap:8px}
    .chip{padding:9px 12px;border-radius:12px;background:var(--btn);border:1px solid var(--btnb);display:inline-flex;align-items:center;gap:8px}
    .card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:14px;margin:10px 0}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
    .muted{color:var(--muted)}
    .mono{font-family:ui-monospace,Consolas,Monaco,monospace}
    .btn{display:inline-block;padding:10px 14px;border-radius:10px;background:var(--btn);border:1px solid var(--btnb);color:var(--txt)}
    .btn:hover{background:var(--brand)}
    .tag{display:inline-block;font-size:12px;padding:2px 8px;border:1px solid var(--btnb);border-radius:999px;margin-left:6px}
    .ok{color:#34d399} .bad{color:#ef4444}
    pre{white-space:pre-wrap;background:#0b1117;border:1px solid var(--border);padding:10px;border-radius:10px;margin:8px 0}
    /* мобайл */
    @media(max-width:840px){
      .grid, .grid3{grid-template-columns:1fr}
      .wrap{padding:10px}
      .brand{font-size:20px}
    }
  </style>`;

  // Верхній блок дій + форма (просили підняти догори)
  const top = `
  <div class="h">
    <div class="brand">🧠 Senti <span class="muted">Learn</span></div>
    <a class="chip" href="${esc(uWithS("/admin/learn/run"))}">▶️ Запустити</a>
    <a class="chip" href="${esc(uWithS("/admin/checklist/html"))}">📝 Checklist</a>
    <a class="chip" href="${esc(uWithS("/admin/energy/html"))}">⚡ Energy</a>
  </div>

  <div class="card">
    <b>Додати в чергу</b>
    <form method="post" action="/admin/learn/enqueue${s ? `?s=${esc(s)}` : ""}">
      <p><input name="url" placeholder="https://посилання або прямий файл" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--btnb);background:#0b1117;color:var(--txt)"/></p>
      <p><input name="name" placeholder="Опційно: назва" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--btnb);background:#0b1117;color:var(--txt)"/></p>
      <p><textarea name="text" rows="5" placeholder="Або встав тут текст, який треба вивчити" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--btnb);background:#0b1117;color:var(--txt)"></textarea></p>
      <p><button class="btn" type="submit">＋ Додати</button></p>
    </form>
    <div class="muted">Підтримуються: статті/сторінки, YouTube (коли є транскрипт), PDF/TXT/MD/ZIP тощо.</div>
  </div>`;

  const kvCard = `
  <div class="card">
    <b>Пам'ять KV</b>
    <div class="muted">Стан: ${kv ? '<span class="ok">під’єднано ✅</span>' : '<span class="bad">не знайдено ❌</span>'}</div>
    <div class="muted">Використовується для: черги Learn, чекліста, інсайтів.</div>
  </div>`;

  const r2Card = `
  <div class="card">
    <b>R2 Storage</b>
    <div class="muted">Стан: ${r2 ? '<span class="ok">під’єднано ✅</span>' : '<span class="bad">не знайдено ❌</span>'}</div>
    <div class="muted">Зберігаємо великі файли: оригінали, очищені тексти, JSON-індекси.</div>
  </div>`;

  const summaryCard = `
  <div class="card">
    <b>Останній підсумок</b>
    <pre>${esc(last || "—")}</pre>
  </div>`;

  const queuedList = `
  <div class="card">
    <div class="row" style="justify-content:space-between">
      <b>Черга</b><span class="muted">${queued.length} елем.</span>
    </div>
    ${
      queued.length
        ? `<ul>${queued
            .map(
              (q) =>
                `<li><span class="mono">${esc(q.kind)}</span> — ${esc(
                  q?.payload?.name || q?.payload?.url || "item"
                )} <span class="muted mono">${esc(q.at || "")}</span></li>`
            )
            .join("")}</ul>`
        : `<p class="muted">Черга порожня.</p>`
    }
  </div>`;

  const insightsList = `
  <div class="card">
    <b>Нещодавні знання (для System Prompt)</b>
    ${
      insights.length
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
        : `<p class="muted">Ще немає збережених знань.</p>`
    }
  </div>`;

  const footerNav = `
  <div class="grid">
    <div class="card"><b>📁 Repo</b><div><a class="btn" href="/admin/repo/html">Відкрити Repo</a></div></div>
    <div class="card"><b>📜 Статут</b><div><a class="btn" href="/admin/statut/html">Відкрити Статут</a></div></div>
  </div>`;

  return html(`${css}<div class="wrap">
    ${top}
    <div class="grid">
      ${kvCard}
      ${r2Card}
    </div>
    ${summaryCard}
    <div class="grid">
      ${queuedList}
      ${insightsList}
    </div>
    ${footerNav}
  </div>`);
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

  // ── Energy UI
  const energyResp = await handleAdminEnergy?.(req, env, url);
  if (energyResp) return energyResp;

  // ── Checklist API/HTML
  const checklistResp = await handleAdminChecklist?.(req, env, url);
  if (checklistResp) return checklistResp;

  // ── Checklist+Energy wrapper (опційно)
  const wrapResp = await handleAdminChecklistWithEnergy?.(req, env, url);
  if (wrapResp) return wrapResp;

  // ── Repo (публічний READ-ONLY, як у 1.8)
  if (req.method === "GET" && p === "/admin/repo/html") {
    try { return html(await repoHtml(env)); }
    catch (e) { return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
  }

  // ── Статут (публічний READ-ONLY)
  if (req.method === "GET" && p === "/admin/statut/html") {
    try { return html(await statutHtml(env)); }
    catch (e) { return json({ ok:false, error:String(e?.message||e) }, { status:500 }); }
  }

  // ── Learn Admin: HTML (захищено секретом)
  if (req.method === "GET" && p === "/admin/learn/html") {
    if (!isAuthed(url, env)) return json({ ok:false, error:"unauthorized" }, { status:401 });
    return learnHtml(env, url);
  }

  // Learn Admin: run once (GET for browser / POST for API)
  if ((req.method === "GET" || req.method === "POST") && p === "/admin/learn/run") {
    if (!isAuthed(url, env)) return json({ ok:false, error:"unauthorized" }, { status:401 });
    try {
      const out = await runLearnOnce(env, { maxItems: Number(url.searchParams.get("n") || 10) });
      if (req.method === "GET") {
        const back = (() => { const u = new URL(url); u.pathname = "/admin/learn/html"; return u.toString(); })();
        return html(`
          <style>.btn{display:inline-block;padding:10px 14px;border-radius:10px;background:#223449;border:1px solid #2d4f6b;color:#e6edf3}</style>
          <pre>${esc(out.summary || JSON.stringify(out, null, 2))}</pre>
          <p><a class="btn" href="${esc(back)}">← Назад</a></p>
        `);
      }
      return json(out);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, { status: 500 });
    }
  }

  // Learn Admin: enqueue (POST form or JSON)
  if (req.method === "POST" && p === "/admin/learn/enqueue") {
    if (!isAuthed(url, env)) return json({ ok:false, error:"unauthorized" }, { status:401 });
    let body = {};
    const ctype = req.headers.get("content-type") || "";
    try {
      if (ctype.includes("application/json")) body = await req.json();
      else if (ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data")) {
        const form = await req.formData(); body = Object.fromEntries(form.entries());
      }
    } catch { body = {}; }

    const userId = url.searchParams.get("u") || "admin";
    const hasText = body?.text && String(body.text).trim().length > 0;
    const hasUrl  = body?.url && String(body.url).startsWith("http");
    if (!hasText && !hasUrl) return json({ ok:false, error:"provide url or text" }, { status:400 });

    if (hasText) await enqueueLearn(env, userId, { text: String(body.text), name: body?.name || "inline-text" });
    if (hasUrl)  await enqueueLearn(env, userId, { url: String(body.url), name: body?.name || String(body.url) });

    if (!ctype.includes("application/json")) {
      const back = new URL(url); back.pathname = "/admin/learn/html";
      return Response.redirect(back.toString(), 303);
    }
    return json({ ok:true });
  }

  // Learn Admin: JSON status
  if (req.method === "GET" && p === "/admin/learn/status") {
    if (!isAuthed(url, env)) return json({ ok:false, error:"unauthorized" }, { status:401 });
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