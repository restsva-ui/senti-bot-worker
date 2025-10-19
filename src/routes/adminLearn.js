// src/routes/adminLearn.js
import { html, json } from "../utils/http.js";
import { abs } from "../utils/url.js";
import {
  enqueueSystemLearn,
  listLearn,
  listSystemLearn,
  clearLearn,
} from "../lib/kvLearnQueue.js";

/**
 * Проста екранізована вставка
 */
const esc = (s = "") =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * Шапка/стилі: адаптив під мобільні, темна тема,
 * кнопка "Запустити навчання зараз".
 */
const page = (env, userId, userItems = [], sysItems = [], runMsg = "") => {
  const tz = env.TIMEZONE || "Europe/Kyiv";

  const rows =
    userItems
      .map(
        (i) =>
          `<tr>
            <td class="cut">${esc(i.name || i.url)}</td>
            <td>${esc(i.type || "-")}</td>
            <td>${new Date(i.when).toLocaleString("uk-UA", { timeZone: tz })}</td>
            <td>${esc(i.status || "queued")}</td>
          </tr>`
      )
      .join("") || `<tr><td colspan="4">— порожньо —</td></tr>`;

  const srows =
    sysItems
      .map(
        (i) =>
          `<tr>
            <td class="cut">${esc(i.name || i.url)}</td>
            <td>${esc(i.type || "-")}</td>
            <td>${new Date(i.when).toLocaleString("uk-UA", { timeZone: tz })}</td>
            <td>${esc(i.status || "queued")}</td>
          </tr>`
      )
      .join("") || `<tr><td colspan="4">— немає записів —</td></tr>`;

  const sParam = env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
  const refreshHref = `/admin/learn/html${sParam}`;
  const runHref =
    `/admin/learn/run${sParam}` + (userId ? `${sParam ? "&" : "?"}u=${encodeURIComponent(userId)}` : "");
  const clearHref =
    `/admin/learn/clear${sParam}` + (userId ? `${sParam ? "&" : "?"}u=${encodeURIComponent(userId)}` : "");

  return `
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Learn (admin)</title>
  <style>
    :root{
      --bg:#0b0f14; --card:#0f1620; --line:#1f2a36; --line2:#2a3a4c; --txt:#eaeaea;
      --accent:#3b82f6; --accent-2:#60a5fa; --ok:#10b981; --warn:#f59e0b;
    }
    *{box-sizing:border-box}
    body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,'Helvetica Neue',sans-serif;color:var(--txt);background:var(--bg);margin:0;padding:16px}
    h1,h2{margin:0 0 12px}
    .wrap{max-width:980px;margin:0 auto}
    .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px}
    .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid var(--line2);background:#121a24;color:var(--txt);border-radius:10px;text-decoration:none}
    .btn.primary{background:var(--accent);border-color:var(--accent-2);color:white}
    .btn.ok{background:var(--ok);border-color:#34d399;color:#012a1b}
    .btn.warn{background:var(--warn);border-color:#fbbf24;color:#2b1a00}
    input[type=text]{flex:1 1 360px;min-width:220px;background:#0b121a;border:1px solid var(--line2);border-radius:8px;color:var(--txt);padding:8px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
    .cut{max-width:480px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    small{opacity:.65}
    .hint{opacity:.8}
    .split{display:grid;grid-template-columns:1fr;gap:12px}
    @media (min-width:820px){ .split{grid-template-columns:1fr 1fr} }
  </style>

  <div class="wrap">
    <h1>🧠 Learn (admin)</h1>

    <div class="card">
      <div class="row" style="gap:10px">
        <form method="GET" action="/admin/learn/add" class="row" style="flex:1">
          <input type="hidden" name="s" value="${env.WEBHOOK_SECRET || ""}">
          <input type="text" name="url" placeholder="https:// (стаття / відео / файл)" required>
          <button class="btn primary" type="submit">Додати в системну чергу</button>
        </form>
        <a class="btn" href="${refreshHref}">Оновити</a>
        <a class="btn ok" href="${runHref}">▶️ Запустити навчання зараз</a>
      </div>
      <p class="hint">Автоматичне фонове навчання запускає нічний агент (див. <code>wrangler.toml</code> <b>[triggers]</b>).</p>
      ${runMsg ? `<p class="hint">Результат запуску: ${esc(runMsg)}</p>` : ""}
    </div>

    <div class="split">
      <div class="card">
        <h2>Твоя черга</h2>
        <table>
          <thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="row">
          <a class="btn warn" href="${clearHref}">🧹 Очистити мою чергу</a>
          <small>userId=${esc(userId || "")}</small>
        </p>
      </div>

      <div class="card">
        <h2>Системна черга</h2>
        <table>
          <thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
          <tbody>${srows}</tbody>
        </table>
      </div>
    </div>
  </div>
  `;
};

export async function handleAdminLearn(req, env, url) {
  const p = url.pathname;

  // проста авторизація секретом (як і інші адмін-сторінки)
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // Додати URL у системну чергу
  if (p.startsWith("/admin/learn/add")) {
    const itemUrl = (url.searchParams.get("url") || "").trim();
    if (!itemUrl) return json({ ok: false, error: "url required" }, 400);
    await enqueueSystemLearn(env, { url: itemUrl, name: itemUrl, type: "url", status: "queued" });
    const back = `/admin/learn/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}`;
    return html(`<p>✅ Додано: ${esc(itemUrl)}</p><p><a href="${back}">Назад</a></p>`);
  }

  // Очистити персональну чергу
  if (p.startsWith("/admin/learn/clear")) {
    const u = url.searchParams.get("u");
    if (!u) return json({ ok: false, error: "u required" }, 400);
    await clearLearn(env, u);
    const back = `/admin/learn/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}`;
    return html(`<p>🧹 Очищено чергу користувача: ${esc(u)}</p><p><a href="${back}">Назад</a></p>`);
  }

  // ▶️ Ручний запуск процесу навчання (фонового інжесту черг)
  // Робимо субзапит до внутрішнього роутера train/evolve (будь-що, що у вас реалізує інжест черг)
  if (p.startsWith("/admin/learn/run")) {
    const u = new URL(abs(env, "/ai/train/run"));
    if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);
    const wantUser = url.searchParams.get("u");
    if (wantUser) u.searchParams.set("u", wantUser);
    // allow "mode=learn" для селективного запуску
    u.searchParams.set("mode", "learn");

    let runMsg = "";
    try {
      const r = await fetch(u.toString(), { method: "POST" });
      const text = await r.text();
      runMsg = r.ok ? `OK ${r.status} — ${text.slice(0, 180)}…` : `ERR ${r.status} — ${text.slice(0, 180)}…`;
    } catch (e) {
      runMsg = `Fetch failed: ${String(e)}`;
    }

    // показуємо оновлену сторінку із повідомленням
    const uid = url.searchParams.get("u") || "(not set)";
    const userItems = uid !== "(not set)" ? await listLearn(env, uid) : [];
    const sysItems = await listSystemLearn(env);
    return html(page(env, uid, userItems, sysItems, runMsg));
  }

  // Рендер HTML/JSON
  const uid = url.searchParams.get("u") || "(not set)";
  const userItems = uid !== "(not set)" ? await listLearn(env, uid) : [];
  const sysItems = await listSystemLearn(env);

  if (p.endsWith("/json")) {
    return json({ ok: true, userId: uid, userItems, sysItems });
  }
  return html(page(env, uid, userItems, sysItems));
}