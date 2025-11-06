// src/routes/adminRepo.js
// Repo / Архіви: HTML-UI, завантаження ZIP, автопромоут після upload,
// ручний авто-промоут, видалення архівів та автоприбирання (prune).

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
  try {
    await env.CHECKLIST_KV.put("brain:current", key);
    await appendChecklist(env, `✅ promote (${source}) → ${key}`);
  } catch (e) {
    console.error("[repo.setCurrent]", e?.message || e);
  }
}

// безпечне base64 (chunked) для великих файлів
function bytesToBase64(u8) {
  const CHUNK = 0x8000; // 32k
  let res = "";
  for (let i = 0; i < u8.length; i += CHUNK) {
    const chunk = u8.subarray(i, i + CHUNK);
    res += String.fromCharCode.apply(null, chunk);
  }
  return btoa(res);
}

// читання JSON-значення архіву (щоб дістати r2Key, якщо є)
async function getArchiveJSON(env, key) {
  try {
    const raw = await env.CHECKLIST_KV.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// видалити архів із KV (+ спробувати з R2, якщо є r2Key)
async function deleteArchive(env, key) {
  const val = await getArchiveJSON(env, key);
  try {
    await env.CHECKLIST_KV.delete(key);
  } catch {}
  const r2Key = val?.r2Key;
  if (r2Key && env.REPO_BUCKET?.delete) {
    try { await env.REPO_BUCKET.delete(r2Key); } catch {}
  }
  await appendChecklist(env, `🗑️ repo:delete → ${key}${r2Key ? ` (and R2:${r2Key})` : ""}`);
  return { ok: true, key, r2Key: r2Key || null };
}

// автоприбирання (залишити N найновіших)
async function pruneArchives(env, keep = 5) {
  const keepN = Math.max(1, Number(keep) || 5);
  const items = await listArchives(env); // від нового до старого
  const toDelete = items.slice(keepN);
  const results = [];
  for (const k of toDelete) {
    results.push(await deleteArchive(env, k));
  }
  await appendChecklist(env, `🧹 repo:prune keep=${keepN} → deleted ${results.length}`);
  return { ok: true, kept: keepN, deleted: results.length, items: results };
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
  .mark{ color:#22c55e; font-weight:600; margin-left:6px }
  .btn{ padding:8px 12px; border-radius:10px; text-decoration:none; border:1px solid color-mix(in oklab, CanvasText 20%, Canvas 80%); background: color-mix(in oklab, Canvas 96%, CanvasText 6%); color:inherit }
  .btn:hover{ background: color-mix(in oklab, Canvas 92%, CanvasText 10%); }
  .btn.danger{ background: color-mix(in oklab, #ffebee 90%, #b71c1c 10%); border-color: color-mix(in oklab, #b71c1c 40%, Canvas 60%) }
  .btn.danger:hover{ background: color-mix(in oklab, #ffebee 85%, #b71c1c 15%); }
  .actions{ display:flex; gap:6px; flex-wrap:wrap }
  form.upl{ display:grid; gap:8px; grid-template-columns: 1fr auto; align-items:center; padding:12px; border:1px dashed color-mix(in oklab, CanvasText 20%, Canvas 80%); border-radius:12px; margin:14px 0 }
  input[type=file]{ padding:8px; border:1px solid color-mix(in oklab, CanvasText 20%, Canvas 80%); border-radius:10px }
  .note{ opacity:.75; font-size:12px }
  .bar{ display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 12px }
</style>
${body}`;
}

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function htmlList(env, url) {
  const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
  const items = await listArchives(env); // від нового до старого
  const cur = await env.CHECKLIST_KV.get("brain:current").catch(() => null);

  const rows = items.map((k) => {
    const isCur = k === cur;

    const ap = new URL("/admin/repo/auto-promote", url.origin);
    if (env.WEBHOOK_SECRET) ap.searchParams.set("s", env.WEBHOOK_SECRET);
    ap.searchParams.set("key", k);

    const del = new URL("/admin/repo/delete", url.origin);
    if (env.WEBHOOK_SECRET) del.searchParams.set("s", env.WEBHOOK_SECRET);
    del.searchParams.set("key", k);

    return `
    <div class="row">
      <div class="name">${esc(k)}${isCur ? '<span class="mark">● current</span>' : ""}</div>
      <div class="actions">
        <a class="btn" href="${ap.toString()}">Auto-promote</a>
        <a class="btn danger" href="${del.toString()}" onclick="return confirm('Видалити архів?')">🗑️ Delete</a>
      </div>
    </div>`;
  }).join("") || `<p class="note">Немає архівів.</p>`;

  const autoLatest = new URL("/admin/repo/auto-promote", url.origin);
  if (env.WEBHOOK_SECRET) autoLatest.searchParams.set("s", env.WEBHOOK_SECRET);

  const prune5 = new URL("/admin/repo/prune", url.origin);
  if (env.WEBHOOK_SECRET) prune5.searchParams.set("s", env.WEBHOOK_SECRET);
  prune5.searchParams.set("keep", "5");

  const prune10 = new URL("/admin/repo/prune", url.origin);
  if (env.WEBHOOK_SECRET) prune10.searchParams.set("s", env.WEBHOOK_SECRET);
  prune10.searchParams.set("keep", "10");

  const body = `
  <h1>Repo / Архіви</h1>

  <form class="upl" action="/admin/repo/upload?s=${s}" method="POST" enctype="multipart/form-data">
    <input type="file" name="file" accept=".zip" required />
    <button class="btn" type="submit">Завантажити ZIP</button>
    <div class="note">Після успішного завантаження виконується selftest і, якщо все ок — архів стає current.</div>
  </form>

  <div class="bar">
    <a class="btn" href="${autoLatest.toString()}">Auto-promote latest</a>
    <a class="btn" href="/api/brain/current?s=${s}">Перевірити current</a>
    <a class="btn" href="${prune5.toString()}" onclick="return confirm('Залишити лише останні 5 архівів?')">Prune to last 5</a>
    <a class="btn" href="${prune10.toString()}" onclick="return confirm('Залишити лише останні 10 архівів?')">Prune to last 10</a>
  </div>

  ${rows}
  `;

  return pageShell({ title: "Repo / Архіви", body });
}

export async function handleAdminRepo(req, env, url) {
  const p = (url.pathname || "").replace(/\/+$/, "");

  if (!p.startsWith("/admin/repo")) return null;

  // простий захист секретом
  if (!ensureSecret(env, url)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  // GET /admin/repo/html — головна сторінка
  if (p === "/admin/repo/html" && req.method === "GET") {
    try {
      return new Response(await htmlList(env, url), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      console.error("[repo.html]", e?.message || e);
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  // POST /admin/repo/upload — завантаження архіву (ZIP)
  if (p === "/admin/repo/upload" && req.method === "POST") {
    try {
      const form = await req.formData();
      const f = form.get("file");
      if (!f || !f.name || !f.arrayBuffer) {
        return json({ ok: false, error: "file missing" }, 400);
      }

      const buf = new Uint8Array(await f.arrayBuffer());
      const b64 = bytesToBase64(buf);

      // ключ: senti_archive/YYYY-MM-DD__<filename>
      const datePart = new Date().toISOString().slice(0, 10);
      const key = `senti_archive/${datePart}__${f.name}`;

      // зберігаємо ZIP (base64 string)
      await saveArchive(env, key, b64);
      await appendChecklist(env, `📦 upload success → ${key}`);

      // selftest (локально, без fetch)
      const st = await runSelfTestLocalDirect(env).catch(() => ({ ok: false }));
      if (st?.ok) {
        await setCurrent(env, key, "upload");
        return json({ ok: true, uploaded: key, auto_promoted: true, selftest: true });
      } else {
        await appendChecklist(env, `⚠️ upload done, but selftest failed → ${key}`);
        return new Response(await htmlList(env, url), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
    } catch (e) {
      console.error("[repo.upload]", e?.message || e);
      await appendChecklist(env, `❌ upload error: ${String(e)}`);
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  // GET /admin/repo/auto-promote[?key=] — ручний авто-промоут з кнопки
  if (p === "/admin/repo/auto-promote" && req.method === "GET") {
    const key = url.searchParams.get("key");
    try {
      // якщо key не передали — беремо найновіший
      const items = await listArchives(env);
      const chosen = key || items[0];
      if (!chosen) return json({ ok: false, error: "no archives" }, 400);

      const st = await runSelfTestLocalDirect(env).catch(() => ({ ok: false }));
      if (!st?.ok) {
        await appendChecklist(env, `⚠️ auto-promote skipped (selftest fail) → ${chosen}`);
        return json({ ok: false, error: "selftest failed", key: chosen }, 409);
      }

      await setCurrent(env, chosen, key ? "button" : "latest");
      return json({ ok: true, promoted: chosen, by: key ? "button" : "latest" });
    } catch (e) {
      console.error("[repo.auto-promote]", e?.message || e);
      await appendChecklist(env, `❌ auto-promote error: ${String(e)}`);
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  // GET /admin/repo/delete?key=... — видалити конкретний архів
  if (p === "/admin/repo/delete" && req.method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return json({ ok: false, error: "missing key" }, 400);
    try {
      const res = await deleteArchive(env, key);
      return new Response(await htmlList(env, url), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      console.error("[repo.delete]", e?.message || e);
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  // GET /admin/repo/prune?keep=N — залишити тільки найновіші N
  if (p === "/admin/repo/prune" && req.method === "GET") {
    const keep = Number(url.searchParams.get("keep") || 5);
    try {
      await pruneArchives(env, keep);
      return new Response(await htmlList(env, url), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      console.error("[repo.prune]", e?.message || e);
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  // інакше — не наш маршрут
  return null;
}