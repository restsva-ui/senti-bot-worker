// src/routes/adminRepo.js
// Repo / Архіви: HTML-UI, завантаження ZIP, автопромоут після upload,
// а також ручний авто-промоут через кнопку в адмінці.

import { saveArchive, listArchives, appendChecklist } from "../lib/kvChecklist.js";
import { runSelfTestLocalDirect } from "./selfTestLocal.js";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

// простий guard за секретом (?s=...)
function ensureSecret(env, url) {
  if (!env.WEBHOOK_SECRET) return true;
  return url.searchParams.get("s") === env.WEBHOOK_SECRET;
}

// встановлення поточного “мозку”
async function setCurrent(env, key, source = "auto") {
  await env.CHECKLIST_KV.put("brain:current", key);
  await appendChecklist(env, `✅ promote (${source}) → ${key}`);
}

// компактний html (мобільний-френдлі)
function pageShell({ title, body }) {
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<style>
  :root{ color-scheme: light dark }
  body{ margin:16px; font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif }
  h1{ font-size:18px; margin:0 0 12px }
  .row{ display:flex; gap:8px; align-items:center; justify-content:space-between; padding:10px; border:1px solid color-mix(in oklab, CanvasText 18%, Canvas 82%); border-radius:12px; margin:8px 0 }
  .name{ word-break: break-all; flex:1; }
  .btn{ padding:8px 12px; border-radius:10px; text-decoration:none; border:1px solid color-mix(in oklab, CanvasText 20%, Canvas 80%); background: color-mix(in oklab, Canvas 96%, CanvasText 6%); color:inherit }
  .actions{ display:flex; gap:6px; }
  form.upl{ display:grid; gap:8px; grid-template-columns: 1fr auto; align-items:center; padding:12px; border:1px dashed color-mix(in oklab, CanvasText 20%, Canvas 80%); border-radius:12px; margin:14px 0 }
  input[type=file]{ padding:8px; border:1px solid color-mix(in oklab, CanvasText 20%, Canvas 80%); border-radius:10px }
  .note{ opacity:.75; font-size:12px }
</style>
${body}`;
}

async function htmlList(env, url) {
  const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
  const items = await listArchives(env); // від нового до старого
  const cur = await env.CHECKLIST_KV.get("brain:current").catch(() => null);

  const rows = items.map((k) => {
    const mark = k === cur ? " • current" : "";
    const ap = new URL("/admin/repo/auto-promote", url.origin);
    ap.searchParams.set("s", env.WEBHOOK_SECRET || "");
    ap.searchParams.set("key", k);

    return `
    <div class="row">
      <div class="name">${k}${mark}</div>
      <div class="actions">
        <a class="btn" href="${ap.toString()}">Auto-promote</a>
      </div>
    </div>`;
  }).join("") || `<p class="note">Немає архівів.</p>`;

  const autoLatest = new URL("/admin/repo/auto-promote", url.origin);
  autoLatest.searchParams.set("s", env.WEBHOOK_SECRET || "");

  const body = `
  <h1>Repo / Архіви</h1>

  <form class="upl" action="/admin/repo/upload?s=${s}" method="POST" enctype="multipart/form-data">
    <input type="file" name="file" accept=".zip" required />
    <button class="btn" type="submit">Завантажити ZIP</button>
    <div class="note">Після успішного завантаження виконується selftest і, якщо все ок — архів стає current.</div>
  </form>

  <div style="display:flex; gap:8px; margin:8px 0;">
    <a class="btn" href="${autoLatest.toString()}">Auto-promote latest</a>
    <a class="btn" href="/api/brain/current?s=${s}">Перевірити current</a>
  </div>

  ${rows}
  `;

  return pageShell({ title: "Repo / Архіви", body });
}

export async function handleAdminRepo(req, env, url) {
  const p = (url.pathname || "").replace(/\/+$/,"");

  if (!p.startsWith("/admin/repo")) return null;

  // простий захист секретом
  if (!ensureSecret(env, url)) {
    return json({ ok:false, error:"unauthorized" }, 401);
  }

  // GET /admin/repo/html — головна сторінка
  if (p === "/admin/repo/html" && req.method === "GET") {
    return new Response(await htmlList(env, url), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // POST /admin/repo/upload — завантаження архіву
  if (p === "/admin/repo/upload" && req.method === "POST") {
    try {
      const form = await req.formData();
      const f = form.get("file");
      if (!f || !f.name || !f.arrayBuffer) {
        return json({ ok:false, error:"file missing" }, 400);
      }

      const buf = new Uint8Array(await f.arrayBuffer());
      // ключ формуємо як: senti_archive/YYYY-MM-DD__<filename>
      const datePart = new Date().toISOString().slice(0,10);
      const key = `senti_archive/${datePart}__${f.name}`;

      // зберігаємо
      await saveArchive(env, key, btoa(String.fromCharCode(...buf)));
      await appendChecklist(env, `📦 upload success → ${key}`);

      // selftest (локально, без fetch)
      const st = await runSelfTestLocalDirect(env).catch(()=>({ ok:false }));
      if (st?.ok) {
        await setCurrent(env, key, "upload");
        return json({ ok:true, uploaded:key, auto_promoted:true, selftest:true });
      } else {
        await appendChecklist(env, `⚠️ upload done, but selftest failed → ${key}`);
        // віддаємо HTML назад (зручніше з телефона)
        return new Response(await htmlList(env, url), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    } catch (e) {
      await appendChecklist(env, `❌ upload error: ${String(e)}`);
      return json({ ok:false, error:String(e) }, 500);
    }
  }

  // GET /admin/repo/auto-promote[?key=] — ручний авто-промоут з кнопки
  if (p === "/admin/repo/auto-promote" && req.method === "GET") {
    const key = url.searchParams.get("key");
    try {
      // якщо key не передали — беремо найновіший
      const items = await listArchives(env);
      const chosen = key || items[0];
      if (!chosen) return json({ ok:false, error:"no archives" }, 400);

      const st = await runSelfTestLocalDirect(env).catch(()=>({ ok:false }));
      if (!st?.ok) {
        await appendChecklist(env, `⚠️ auto-promote skipped (selftest fail) → ${chosen}`);
        return json({ ok:false, error:"selftest failed", key:chosen }, 409);
      }

      await setCurrent(env, chosen, key ? "button" : "latest");
      return json({ ok:true, promoted: chosen, by: key ? "button" : "latest" });
    } catch (e) {
      await appendChecklist(env, `❌ auto-promote error: ${String(e)}`);
      return json({ ok:false, error:String(e) }, 500);
    }
  }

  // інакше — не наш маршрут
  return null;
}