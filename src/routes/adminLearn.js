// src/routes/adminLearn.js
import { html, json } from "../utils/http.js";
import {
  enqueueSystemLearn,
  listLearn,
  listSystemLearn,
  clearLearn,
} from "../lib/kvLearnQueue.js";

const css = /*css*/`
  :root{
    --bg:#0b0f14; --panel:#0f1620; --line:#1f2a36; --muted:#8fa0b3;
    --fg:#eaeaea; --btn:#1f2a36; --btn-b:#2a3a4c; --ok:#12b981; --warn:#f59e0b;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,sans-serif}
  .wrap{max-width:980px;margin:0 auto;padding:20px}
  h1{margin:4px 0 16px}
  section{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px;margin:0 0 14px}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  input[type=text]{flex:1;min-width:220px;padding:10px 12px;border-radius:10px;border:1px solid #243243;background:#0b121a;color:var(--fg)}
  .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:12px;border:1px solid var(--btn-b);background:var(--btn);color:var(--fg);text-decoration:none}
  .btn.ok{background:#0f2a20;border-color:#1a4a36}
  .btn.ok::before{content:"▶️"}
  .btn.warn{background:#2a1f0f;border-color:#4a3a1a}
  .btn.small{padding:8px 10px;border-radius:10px}
  .hint{color:var(--muted);font-size:13px;margin-top:8px}
  table{width:100%;border-collapse:collapse}
  th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}
  td:last-child,th:last-child{text-align:left}
  @media (max-width:640px){
    .wrap{padding:14px}
    .row{gap:8px}
    .btn{width:100%;justify-content:center}
    input[type=text]{width:100%}
    table,thead,tbody,tr,td,th{display:block}
    thead{display:none}
    tr{border-bottom:1px solid var(--line);padding:6px 0}
    td{border:none;padding:4px 0}
    td::before{content:attr(data-k)+": ";color:var(--muted)}
  }
`;

function esc(s = "") {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmt(env, ts) {
  try {
    return new Date(ts).toLocaleString("uk-UA", { timeZone: env.TIMEZONE || "Europe/Kyiv" });
  } catch { return String(ts); }
}

function tableRows(env, items) {
  if (!items?.length) {
    return `<tr><td data-k="Назва/URL" colspan="4">— немає записів —</td></tr>`;
  }
  return items.map(i => `
    <tr>
      <td data-k="Назва/URL">${esc(i.name || i.url || "")}</td>
      <td data-k="Тип">${esc(i.type || "url")}</td>
      <td data-k="Коли">${esc(fmt(env, i.when || Date.now()))}</td>
      <td data-k="Статус">${esc(i.status || "queued")}</td>
    </tr>`).join("");
}

function page(env, userId, userItems = [], sysItems = [], runMsg = "") {
  const sParam = env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : "";
  return /*html*/`
  <meta name=viewport content="width=device-width,initial-scale=1">
  <style>${css}</style>
  <div class="wrap">
    <h1>🧠 Learn (admin)</h1>

    <section>
      <form method="GET" action="/admin/learn/add" class="row">
        <input type="hidden" name="s" value="${env.WEBHOOK_SECRET || ""}">
        <input type="text" name="url" placeholder="https:// (стаття / відео / файл)" required>
        <button class="btn" type="submit">Додати в системну чергу</button>
        <a class="btn small" href="/admin/learn/html${sParam}">Оновити</a>
      </form>

      <div style="margin-top:12px" class="row">
        <a class="btn ok" href="/ai/learn/run${sParam}">Запустити навчання зараз</a>
      </div>
      <p class="hint">
        Автоматичне фонове навчання запускає нічний агент (див. <code>wrangler.toml [triggers]</code>).
      </p>
      ${runMsg ? `<p class="hint" style="margin-top:6px">Результат запуску: ${esc(runMsg)}</p>` : ""}
    </section>

    <section>
      <h2>Твоя черга</h2>
      <table>
        <thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
        <tbody>${tableRows(env, userItems)}</tbody>
      </table>
      <p>
        <a class="btn warn" href="/admin/learn/clear${sParam}&u=${encodeURIComponent(userId)}">Очистити мою чергу</a>
        <span class="hint" style="margin-left:10px">userId=${esc(userId)}</span>
      </p>
    </section>

    <section>
      <h2>Системна черга</h2>
      <table>
        <thead><tr><th>Назва/URL</th><th>Тип</th><th>Коли</th><th>Статус</th></tr></thead>
        <tbody>${tableRows(env, sysItems)}</tbody>
      </table>
    </section>
  </div>`;
}

export async function handleAdminLearn(req, env, url) {
  const p = url.pathname;

  // проста авторизація через секрет
  if (env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  if (p.startsWith("/admin/learn/add")) {
    const itemUrl = (url.searchParams.get("url") || "").trim();
    if (!itemUrl) return json({ ok: false, error: "url required" }, 400);
    await enqueueSystemLearn(env, { url: itemUrl, name: itemUrl });
    return html(`<p>✅ Додано: ${esc(itemUrl)}</p><p><a class="btn" href="/admin/learn/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}">← Назад</a></p>`);
  }

  if (p.startsWith("/admin/learn/clear")) {
    const u = url.searchParams.get("u");
    if (!u) return json({ ok: false, error: "u required" }, 400);
    await clearLearn(env, u);
    return html(`<p>🧹 Очищено чергу користувача: ${esc(u)}</p><p><a class="btn" href="/admin/learn/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}">← Назад</a></p>`);
  }

  // основні HTML/JSON
  const uid = url.searchParams.get("u") || "(not set)";
  const userItems = uid !== "(not set)" ? await listLearn(env, uid).catch(() => []) : [];
  const sysItems = await listSystemLearn(env).catch(() => []);

  if (p.endsWith("/json")) {
    return json({ ok: true, userId: uid, userItems, sysItems });
  }

  // повідомлення про останній запуск (може прийти як ?m=...)
  const runMsg = url.searchParams.get("m") || "";

  return html(page(env, uid, userItems, sysItems, runMsg));
}