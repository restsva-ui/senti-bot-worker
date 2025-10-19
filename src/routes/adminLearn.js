// src/routes/adminLearn.js
import { html, json } from "../utils/http.js";
import { enqueueSystemLearn, listLearn, listSystemLearn, clearLearn } from "../lib/kvLearnQueue.js";

const page = (env, userId, userItems = [], sysItems = []) => {
  const esc = (s="") => String(s).replace(/[&<>"]/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const rows = userItems.map(i => `<tr><td>${esc(i.name||i.url)}</td><td>${esc(i.type)}</td><td>${new Date(i.when).toLocaleString("uk-UA", { timeZone: env.TIMEZONE || "Europe/Kyiv" })}</td><td>${esc(i.status)}</td></tr>`).join("") || `<tr><td colspan="4">— порожньо —</td></tr>`;
  const srows = sysItems.map(i => `<tr><td>${esc(i.name||i.url)}</td><td>${esc(i.type)}</td><td>${new Date(i.when).toLocaleString("uk-UA", { timeZone: env.TIMEZONE || "Europe/Kyiv" })}</td><td>${esc(i.status)}</td></tr>`).join("") || `<tr><td colspan="4">— немає записів —</td></tr>`;

  const base = `
  <style>
    body{font:14px/1.45 system-ui,sans-serif;color:#eaeaea;background:#0b0f14;margin:0;padding:24px}
    h1,h2{margin:0 0 12px}
    section{background:#0f1620;border:1px solid #1f2a36;border-radius:12px;padding:16px;margin:0 0 16px}
    table{width:100%;border-collapse:collapse}
    th,td{border-bottom:1px solid #1f2a36;padding:8px 6px;text-align:left}
    .btn{display:inline-block;padding:8px 12px;background:#1f2a36;border:1px solid #2a3a4c;border-radius:10px;color:#eaeaea;text-decoration:none}
    .row{display:flex;gap:8px;align-items:center}
    input[type=text]{width:420px;background:#0b121a;border:1px solid #243243;border-radius:8px;color:#eaeaea;padding:8px}
    small{opacity:.6}
  </style>
  <h1>🧠 Learn (admin)</h1>
  <section class="row">
    <form method="GET" action="/admin/learn/add" class="row">
      <input type="hidden" name="s" value="${env.WEBHOOK_SECRET || ""}">
      <input type="text" name="url" placeholder="https://..." required>
      <button class="btn" type="submit">Додати в системну чергу</button>
    </form>
    <a class="btn" href="/admin/learn/html${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}`:""}">Оновити</a>
  </section>

  <section>
    <h2>Твоя черга</h2>
    <table><thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p><a class="btn" href="/admin/learn/clear${env.WEBHOOK_SECRET?`?s=${encodeURIComponent(env.WEBHOOK_SECRET)}&u=${userId}`:""}">Очистити мою чергу</a></p>
    <small>userId=${userId}</small>
  </section>

  <section>
    <h2>Системна черга</h2>
    <table><thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
    <tbody>${srows}</tbody></table>
  </section>
  `;
  return base;
};

export async function handleAdminLearn(req, env, url) {
  const p = url.pathname;
  // авторизація (простий секрет як і в інших адмін-сторінках)
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
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

  // основні HTML/JSON в’юшки
  const uid = url.searchParams.get("u") || "(not set)";
  const userItems = uid !== "(not set)" ? await listLearn(env, uid) : [];
  const sysItems = await listSystemLearn(env);
  if (p.endsWith("/json")) {
    return json({ ok:true, userId: uid, userItems, sysItems });
  }
  return html(page(env, uid, userItems, sysItems));
}