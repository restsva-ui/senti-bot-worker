// src/routes/adminLearn.js
import { html, json } from "../utils/http.js";
import {
  enqueueSystemLearn,
  listLearn,
  listSystemLearn,
  clearLearn,
  runLearnOnce,
  markAsProcessing,
  markAsDone,
} from "../lib/kvLearnQueue.js";

const page = (env, userId, userItems = [], sysItems = [], lastRun = null) => {
  const esc = (s="") => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const fmt = (arr, empty) =>
    arr.map(i=>`<tr>
      <td class="nowrap">${esc(i.name||i.url)}</td>
      <td class="nowrap">${esc(i.type)}</td>
      <td class="nowrap">${new Date(i.when).toLocaleString("uk-UA",{ timeZone: env.TIMEZONE||"Europe/Kyiv"})}</td>
      <td class="nowrap ${esc(i.status)}">${esc(i.status)}</td>
    </tr>`).join("") || `<tr><td colspan="4">${empty}</td></tr>`;

  return `
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    :root{--bg:#0b0f14;--panel:#0f1620;--line:#1f2a36;--text:#eaeaea;--muted:#9fb0c3;--accent:#3b82f6}
    *{box-sizing:border-box} body{font:14px/1.45 system-ui,sans-serif;color:var(--text);background:var(--bg);margin:0;padding:16px}
    section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 16px}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    input[type=text]{flex:1;min-width:220px;background:#0b121a;border:1px solid #243243;border-radius:10px;color:var(--text);padding:10px 12px}
    .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:10px;border:1px solid #2a3a4c;background:#1f2a36;color:var(--text);text-decoration:none}
    .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
    table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left}
    .nowrap{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:32ch}
    td.done{color:#10b981} td.processing{color:#f59e0b} td.failed{color:#ef4444}
    .muted{color:var(--muted)} .runresult{margin-top:8px;color:var(--muted)}
  </style>

  <h1>🧠 Learn (admin)</h1>
  <section>
    <form method="GET" action="/admin/learn/add" class="row">
      <input type="hidden" name="s" value="${esc(env.WEBHOOK_SECRET||"")}">
      <input type="text" name="url" placeholder="https:// (стаття / відео / файл)" required>
      <button class="btn primary" type="submit">Додати в системну чергу</button>
      <a class="btn" href="/admin/learn/html${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}">Оновити</a>
    </form>
    <div style="margin-top:10px" class="row">
      <a class="btn" href="/ai/learn/run${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}">▶️ Запустити навчання зараз</a>
      <span class="muted">Автоматичне навчання запускає нічний агент (див. <code>wrangler.toml</code>).</span>
      ${lastRun ? `<div class="runresult">Результат запуску: ${esc(lastRun)}</div>` : ""}
    </div>
  </section>

  <section>
    <h3>Твоя черга</h3>
    <table><thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
    <tbody>${fmt(userItems,"— порожньо —")}</tbody></table>
    <p><a class="btn" href="/admin/learn/clear${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}&u=${encodeURIComponent(userId)}`:""}">🧹 Очистити мою чергу</a>
       <span class="muted">userId=${esc(userId)}</span></p>
  </section>

  <section>
    <h3>Системна черга</h3>
    <table><thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
    <tbody>${fmt(sysItems,"— немає записів —")}</tbody></table>
  </section>`;
};

export async function handleAdminLearn(req, env, url) {
  const p = url.pathname;
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
    return json({ ok:false, error:"unauthorized" }, 401);
  }

  if (p.startsWith("/admin/learn/add")) {
    const itemUrl = (url.searchParams.get("url") || "").trim();
    if (!itemUrl) return json({ ok:false, error:"url required" }, 400);
    await enqueueSystemLearn(env, { url: itemUrl, name: itemUrl });
    return html(`<p>✅ Додано: ${itemUrl}</p><p><a href="/admin/learn/html${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}">Назад</a></p>`);
  }
  if (p.startsWith("/admin/learn/clear")) {
    const u = url.searchParams.get("u");
    if (!u) return json({ ok:false, error:"u required" }, 400);
    await clearLearn(env, u);
    return html(`<p>🧹 Очищено чергу користувача: ${u}</p><p><a href="/admin/learn/html${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}">Назад</a></p>`);
  }
  if (p.startsWith("/ai/learn/run")) {
    const res = await runLearnOnce(env, {});
    const msg = res?.ok ? `OK, processed: ${res.processed.length}` : "ERR";
    const back = `/admin/learn/html${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}&last=${encodeURIComponent(msg)}`;
    return html(`<p>${msg}</p><p><a href="${back}">Назад</a></p>`);
  }

  const uid = url.searchParams.get("u") || (env.TELEGRAM_ADMIN_ID || "(not set)");
  const userItems = uid ? await listLearn(env, uid) : [];
  const sysItems  = await listSystemLearn(env);
  if (p.endsWith("/json")) return json({ ok:true, userId: uid, userItems, sysItems });

  const last = url.searchParams.get("last");
  return html(page(env, uid, userItems, sysItems, last));
}
