// src/routes/adminLearn.js
import { html, json } from "../utils/http.js";
import {
  enqueueSystemLearn,
  listLearn,
  listSystemLearn,
  clearLearn,
} from "../lib/kvLearnQueue.js";

const render = (env, userId, userItems = [], sysItems = []) => {
  const esc = (s = "") =>
    String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const tr = (rows) =>
    rows.length
      ? rows
          .map(
            (i) => `<tr>
        <td>${esc(i.name || i.url)}</td>
        <td>${esc(i.type || "-")}</td>
        <td>${new Date(i.when).toLocaleString("uk-UA", {
          timeZone: env.TIMEZONE || "Europe/Kyiv",
        })}</td>
        <td>${esc(i.status || "-")}</td>
      </tr>`
          )
          .join("")
      : `<tr><td colspan="4">— немає записів —</td></tr>`;

  const qs = env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
  const addAction = `/admin/learn/add${qs}`;
  const refresh = `/admin/learn/html${qs}`;
  const runNow = `/ai/improve/run${qs}`;
  const clearMine = `/admin/learn/clear${qs}&u=${encodeURIComponent(userId || "")}`;

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>🧠 Learn (admin)</title>
<style>
  :root { --bg:#0b0f14; --panel:#0f1620; --line:#1f2a36; --fg:#eaeaea; --muted:#a9b3be; --btn:#1f2a36; --btnb:#2a3a4c; }
  *{box-sizing:border-box}
  body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,Noto Sans,sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:16px}
  h1,h2{margin:0 0 12px}
  section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px;margin:0 0 12px}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .btn{display:inline-block;padding:10px 14px;background:var(--btn);border:1px solid var(--btnb);border-radius:10px;color:var(--fg);text-decoration:none}
  .btn.primary{background:#234;border-color:#345}
  input[type=text]{flex:1;min-width:220px;background:#0b121a;border:1px solid #243243;border-radius:8px;color:var(--fg);padding:10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
  small{opacity:.7}
  @media (max-width:640px){
    table, thead, tbody, th, td, tr { display:block; }
    thead{display:none}
    tr{border-bottom:1px solid var(--line); margin:0 0 8px; padding:8px 0}
    td{border:none; padding:4px 0}
    td::before{content:attr(data-h); display:block; font-weight:600; color:var(--muted)}
  }
</style>
</head>
<body>
  <h1>🧠 Learn (admin)</h1>

  <section class="row">
    <form method="GET" action="${addAction}" class="row" style="flex:1">
      <input type="text" name="url" placeholder="https://… (стаття / відео / файл)" required>
      <button class="btn" type="submit">Додати в системну чергу</button>
    </form>
    <a class="btn" href="${refresh}">Оновити</a>
    <a class="btn primary" href="${runNow}">▶︎ Запустити навчання зараз</a>
  </section>

  <section>
    <h2>Твоя черга</h2>
    <table>
      <thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
      <tbody>
        ${tr(userItems)
          .replaceAll("<td>", '<td data-h="Поле">')
          .replace('<td data-h="Поле">', '<td data-h="Назва/URL">')
          .replace('<td data-h="Поле">', '<td data-h="Тип">')
          .replace('<td data-h="Поле">', '<td data-h="Коли">')
          .replace('<td data-h="Поле">', '<td data-h="Статус">')}
      </tbody>
    </table>
    <p>
      <a class="btn" href="${clearMine}">🧹 Очистити мою чергу</a>
      <br><small>userId=${userId || "(anonymous)"} | TZ=${env.TIMEZONE || "Europe/Kyiv"}</small>
    </p>
  </section>

  <section>
    <h2>Системна черга</h2>
    <table>
      <thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
      <tbody>
        ${tr(sysItems)
          .replaceAll("<td>", '<td data-h="Поле">')
          .replace('<td data-h="Поле">', '<td data-h="Назва/URL">')
          .replace('<td data-h="Поле">', '<td data-h="Тип">')
          .replace('<td data-h="Поле">', '<td data-h="Коли">')
          .replace('<td data-h="Поле">', '<td data-h="Статус">')}
      </tbody>
    </table>
  </section>
</body></html>`;
};

export async function handleAdminLearn(req, env, url) {
  // авторизація
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const p = url.pathname;

  if (p.startsWith("/admin/learn/add")) {
    const itemUrl = (url.searchParams.get("url") || "").trim();
    if (!itemUrl) return json({ ok: false, error: "url required" }, 400);
    await enqueueSystemLearn(env, { url: itemUrl, name: itemUrl, type: "url" });
    const qs = env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
    return html(`<p>✅ Додано: ${itemUrl}</p><p><a href="/admin/learn/html${qs}">Назад</a></p>`);
  }

  if (p.startsWith("/admin/learn/clear")) {
    const u = url.searchParams.get("u");
    if (!u) return json({ ok: false, error: "u required" }, 400);
    await clearLearn(env, u);
    const qs = env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
    return html(`<p>🧹 Очищено чергу користувача: ${u}</p><p><a href="/admin/learn/html${qs}">Назад</a></p>`);
  }

  const uid = url.searchParams.get("u") || "(not set)";
  const userItems = uid !== "(not set)" ? await listLearn(env, uid) : [];
  const sysItems = await listSystemLearn(env);

  if (p.endsWith("/json")) {
    return json({ ok: true, userId: uid, userItems, sysItems });
  }

  return html(render(env, uid, userItems, sysItems));
}