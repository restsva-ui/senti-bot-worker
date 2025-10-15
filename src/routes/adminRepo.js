// src/routes/adminRepo.js
// ─────────────────────────────────────────────────────────────────────────────
// Repo / Архіви:
// 1) HTML-UI для редагування репо в KV (list/get/put/delete + live preview)
// 2) Публічний renderer /repo/render (з контент-тайпами)
// 3) Завантаження ZIP-архівів + auto-promote після selftest
// 4) Ручний auto-promote кнопкою
//
// Усі адмін-ендпоінти захищені ?s=WEBHOOK_SECRET
// /repo/render може бути публічним, якщо REPO_PUBLIC="on"
// ─────────────────────────────────────────────────────────────────────────────

import { saveArchive, listArchives, appendChecklist } from "../lib/kvChecklist.js";
import { runSelfTestLocalDirect } from "./selfTestLocal.js";

// ───────── basics ─────────
const J = (o, status = 200) =>
  new Response(JSON.stringify(o, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const H = (html, status = 200) =>
  new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });

// простий guard за секретом (?s=...)
function ensureSecret(env, url) {
  if (!env.WEBHOOK_SECRET) return true;
  return url.searchParams.get("s") === env.WEBHOOK_SECRET;
}

// чи можна рендерити без секрету
function canRender(env, url) {
  const pub = String(env.REPO_PUBLIC || "off").toLowerCase() === "on";
  return pub || ensureSecret(env, url);
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

const esc = (s = "") =>
  String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));

// ───────── Repo editor (KV) ─────────

// вибір namespace для коду
function pickNS(env, name) {
  const map = {
    CODE_KV: env?.CODE_KV,
    STATE_KV: env?.STATE_KV,
    ARCHIVE_KV: env?.ARCHIVE_KV,
    CHECKLIST_KV: env?.CHECKLIST_KV,
  };
  return map[name] || env?.CODE_KV || env?.STATE_KV || null;
}

function normalizeKey(path) {
  if (!path) return "code:index.html";
  return path.startsWith("code:") ? path : `code:${path}`;
}

function guessType(name = "") {
  const n = name.toLowerCase();
  if (n.endsWith(".html") || n.endsWith(".htm")) return "text/html; charset=utf-8";
  if (n.endsWith(".css")) return "text/css; charset=utf-8";
  if (n.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (n.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (n.endsWith(".json")) return "application/json; charset=utf-8";
  if (n.endsWith(".svg")) return "image/svg+xml";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".gif")) return "image/gif";
  if (n.endsWith(".ico")) return "image/x-icon";
  if (n.endsWith(".wasm")) return "application/wasm";
  if (n.endsWith(".txt") || n.endsWith(".md")) return "text/plain; charset=utf-8";
  if (n.endsWith(".zip")) return "application/zip";
  return "application/octet-stream";
}

function repoUi(url, env) {
  const sec = url.searchParams.get("s") || "";
  const nsName = url.searchParams.get("ns") || "CODE_KV";
  const nsOptions = ["CODE_KV", "STATE_KV", "ARCHIVE_KV", "CHECKLIST_KV"]
    .map((n) => `<option ${n === nsName ? "selected" : ""} value="${n}">${n}</option>`)
    .join("");

  const archivesHref = (() => {
    const u = new URL("/admin/repo/html", url.origin);
    if (env.WEBHOOK_SECRET) u.searchParams.set("s", env.WEBHOOK_SECRET);
    return u.toString();
  })();

  const healthHref = new URL("/health", url.origin).toString();
  const versionHref = new URL("/_version", url.origin).toString();

  return `<!doctype html>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Repo Editor</title>
<style>
  :root{color-scheme:dark}
  body{font:14px/1.5 -apple-system,system-ui,Segoe UI,Roboto,Ubuntu,sans-serif;background:#0b0b0b;color:#eee;margin:0}
  .wrap{max-width:1200px;margin:0 auto;padding:16px}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0}
  select,input,textarea,button{background:#0f1115;color:#e6e6e6;border:1px solid #2a2a2a;border-radius:12px;padding:10px}
  textarea{width:100%;min-height:260px;font-family:ui-monospace,Menlo,Consolas,monospace;border-radius:16px}
  button{cursor:pointer}
  .btn{background:#1f2937;border:1px solid #334155;border-radius:12px;padding:10px 14px}
  .split{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media (max-width:900px){.split{grid-template-columns:1fr}}
  iframe{width:100%;height:60vh;border:1px solid #2a2a2a;border-radius:16px;background:#fff}
  .muted{opacity:.7}
  .badge{background:#111827;border:1px solid #374151;border-radius:10px;padding:6px 10px}
  .tools{display:flex;gap:8px}
  a.link{color:#93c5fd;text-decoration:none}
</style>
<div class="wrap">
  <h1>📁 Repo Editor <span class="badge" id="nsLabel">${esc(nsName)}</span></h1>

  <div class="row tools">
    <a class="btn link" href="${versionHref}" target="_blank">ℹ️ Version</a>
    <a class="btn link" href="${healthHref}" target="_blank">🩺 Health</a>
    <a class="btn link" href="${archivesHref}">Архіви (ZIP)</a>
  </div>

  <div class="row">
    <label>Namespace:
      <select id="ns">${nsOptions}</select>
    </label>
    <button class="btn" id="openHere">Відкрити</button>
    <button class="btn" id="btnList">List</button>
    <input id="prefix" placeholder="prefix (напр. code: або code:site/)" style="flex:1;min-width:220px"/>
  </div>

  <div class="row">
    <input id="path" placeholder="path (напр. index.html або code:index.html)" style="flex:1;min-width:220px"/>
    <button class="btn" id="btnLoad">Load</button>
    <button class="btn" id="btnSave">Save</button>
    <button class="btn" id="btnDelete" style="border-color:#7f1d1d;background:#1f1020">Delete</button>
    <button class="btn" id="btnOpen">Open /repo/render</button>
  </div>

  <div class="split">
    <div>
      <textarea id="value" placeholder="HTML/CSS/JS/JSON..."></textarea>
      <p class="muted">Збереження: POST → <code>/admin/repo/put?ns=&path=&s=...</code></p>
      <pre id="out" style="white-space:pre-wrap"></pre>
    </div>
    <div>
      <iframe id="preview" src="about:blank"></iframe>
    </div>
  </div>
</div>
<script>
(function(){
  const SECRET = ${JSON.stringify(sec)};
  const nsSel = document.getElementById('ns');
  const nsLabel = document.getElementById('nsLabel');
  const prefix = document.getElementById('prefix');
  const path = document.getElementById('path');
  const value = document.getElementById('value');
  const out = document.getElementById('out');
  const preview = document.getElementById('preview');

  function build(base, params){
    const u = new URL(base, location.origin);
    for(const [k,v] of Object.entries(params)) if (v!==undefined && v!=="") u.searchParams.set(k,v);
    return u.toString();
  }
  function setOut(x){ out.textContent = typeof x === 'string' ? x : JSON.stringify(x,null,2); }

  document.getElementById('openHere').onclick = () => {
    location.href = build('/admin/repo', { ns: nsSel.value, s: SECRET });
  };

  document.getElementById('btnList').onclick = async () => {
    const u = build('/admin/repo/list', { ns: nsSel.value, prefix: prefix.value, s: SECRET });
    const r = await fetch(u); setOut(await r.json());
  };

  document.getElementById('btnLoad').onclick = async () => {
    const u = build('/admin/repo/get', { ns: nsSel.value, path: path.value, s: SECRET });
    const r = await fetch(u); const d = await r.json();
    setOut(d); value.value = (d && d.value) || "";
    if ((path.value||"").toLowerCase().endsWith('.html')) {
      preview.src = build('/repo/render', { ns: nsSel.value, path: path.value, s: SECRET, _ts: Date.now() });
    }
  };

  document.getElementById('btnSave').onclick = async () => {
    const u = build('/admin/repo/put', { ns: nsSel.value, path: path.value, s: SECRET });
    const r = await fetch(u, { method:'POST', body: value.value });
    const d = await r.json(); setOut(d);
    if ((path.value||"").toLowerCase().endsWith('.html')) {
      preview.src = build('/repo/render', { ns: nsSel.value, path: path.value, s: SECRET, _ts: Date.now() });
    }
  };

  document.getElementById('btnDelete').onclick = async () => {
    if (!path.value) return alert("Вкажи path");
    if (!confirm("Видалити " + path.value + " ?")) return;
    const u = build('/admin/repo/delete', { ns: nsSel.value, path: path.value, s: SECRET });
    const r = await fetch(u, { method:'POST' }); setOut(await r.json());
  };

  document.getElementById('btnOpen').onclick = () => {
    if (!path.value) return alert("Вкажи path");
    window.open(build('/repo/render', { ns: nsSel.value, path: path.value, s: SECRET }), '_blank');
  };

  nsSel.onchange = () => { nsLabel.textContent = nsSel.value; };
})();
</script>`;
}

// компактний html-шел для сторінки Архівів
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
  .actions{ display:flex; gap:6px; }
  form.upl{ display:grid; gap:8px; grid-template-columns: 1fr auto; align-items:center; padding:12px; border:1px dashed color-mix(in oklab, CanvasText 20%, Canvas 80%); border-radius:12px; margin:14px 0 }
  input[type=file]{ padding:8px; border:1px solid color-mix(in oklab, CanvasText 20%, Canvas 80%); border-radius:10px }
  .note{ opacity:.75; font-size:12px }
</style>
${body}`;
}

// список архівів (стара адмінка)
async function htmlList(env, url) {
  const s = encodeURIComponent(env.WEBHOOK_SECRET || "");
  const items = await listArchives(env); // від нового до старого
  const cur = await env.CHECKLIST_KV.get("brain:current").catch(() => null);

  const rows =
    items
      .map((k) => {
        const isCur = k === cur;
        const ap = new URL("/admin/repo/auto-promote", url.origin);
        if (env.WEBHOOK_SECRET) ap.searchParams.set("s", env.WEBHOOK_SECRET);
        ap.searchParams.set("key", k);

        return `
    <div class="row">
      <div class="name">${k}${isCur ? '<span class="mark">● current</span>' : ""}</div>
      <div class="actions">
        <a class="btn" href="${ap.toString()}">Auto-promote</a>
      </div>
    </div>`;
      })
      .join("") || `<p class="note">Немає архівів.</p>`;

  const autoLatest = new URL("/admin/repo/auto-promote", url.origin);
  if (env.WEBHOOK_SECRET) autoLatest.searchParams.set("s", env.WEBHOOK_SECRET);

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
    <a class="btn" href="/admin/repo?s=${s}">Редактор репо</a>
  </div>

  ${rows}
  `;

  return pageShell({ title: "Repo / Архіви", body });
}

// ───────── main handler ─────────
export async function handleAdminRepo(req, env, url) {
  const p = (url.pathname || "").replace(/\/+$/, "");

  // ── Repo editor UI ──
  if (p === "/admin/repo" && req.method === "GET") {
    if (!ensureSecret(env, url)) return J({ ok: false, error: "unauthorized" }, 401);
    return H(repoUi(url, env));
  }

  // ── Repo editor API ──
  if (
    (p === "/admin/repo/list" || p === "/admin/repo/get" || p === "/admin/repo/exists") &&
    req.method === "GET"
  ) {
    if (!ensureSecret(env, url)) return J({ ok: false, error: "unauthorized" }, 401);
    const nsName = url.searchParams.get("ns") || "CODE_KV";
    const store = pickNS(env, nsName);
    if (!store) return J({ ok: false, error: `Unknown namespace ${nsName}` }, 400);

    if (p === "/admin/repo/list") {
      const prefix = url.searchParams.get("prefix") || "code:";
      const items = [];
      let cursor;
      do {
        const { keys, list_complete, cursor: next } = await store.list({ prefix, cursor });
        (keys || []).forEach((k) => items.push({ key: k.name, ts: k?.metadata?.ts ?? k?.expiration ?? null }));
        cursor = list_complete ? null : next;
      } while (cursor);
      return J({ ok: true, items });
    }

    if (p === "/admin/repo/get") {
      const path = url.searchParams.get("path") || "";
      if (!path) return J({ ok: false, error: "Missing path" }, 400);
      const key = normalizeKey(path);
      const value = await store.get(key, "text");
      return J({ ok: true, path, key, value });
    }

    if (p === "/admin/repo/exists") {
      const path = url.searchParams.get("path") || "";
      if (!path) return J({ ok: false, error: "Missing path" }, 400);
      const k1 = normalizeKey(path);
      const k2 = path;
      const v1 = await store.get(k1);
      if (v1 != null) return J({ ok: true, exists: true, key: k1 });
      const v2 = await store.get(k2);
      return J({ ok: true, exists: v2 != null, key: v2 != null ? k2 : k1 });
    }
  }

  if (p === "/admin/repo/put" && req.method === "POST") {
    if (!ensureSecret(env, url)) return J({ ok: false, error: "unauthorized" }, 401);
    const nsName = url.searchParams.get("ns") || "CODE_KV";
    const store = pickNS(env, nsName);
    if (!store) return J({ ok: false, error: `Unknown namespace ${nsName}` }, 400);
    const path = url.searchParams.get("path") || "";
    if (!path) return J({ ok: false, error: "Missing path" }, 400);
    const key = normalizeKey(path);
    const body = await req.text();
    await store.put(key, body ?? "", { metadata: { ts: Date.now(), path } });
    return J({ ok: true, saved: true, key, bytes: (body || "").length });
  }

  if (p === "/admin/repo/delete" && req.method === "POST") {
    if (!ensureSecret(env, url)) return J({ ok: false, error: "unauthorized" }, 401);
    const nsName = url.searchParams.get("ns") || "CODE_KV";
    const store = pickNS(env, nsName);
    if (!store) return J({ ok: false, error: `Unknown namespace ${nsName}` }, 400);
    const path = url.searchParams.get("path") || "";
    if (!path) return J({ ok: false, error: "Missing path" }, 400);
    const key = normalizeKey(path);
    await store.delete(key);
    return J({ ok: true, deleted: key });
  }

  // ── Public renderer (може бути публічним при REPO_PUBLIC="on") ──
  if (p === "/repo/render" && (req.method === "GET" || req.method === "HEAD")) {
    if (!canRender(env, url)) return J({ ok: false, error: "unauthorized" }, 401);

    const nsName = url.searchParams.get("ns") || "CODE_KV";
    const store = pickNS(env, nsName);
    if (!store) return J({ ok: false, error: `Unknown namespace ${nsName}` }, 400);

    const path = url.searchParams.get("path") || "index.html";
    const ct = guessType(path);

    // helper: get either text or binary; try code:<path> then <path>
    async function getEither() {
      const k1 = normalizeKey(path);
      const k2 = path;
      const isText = ct.startsWith("text/") || ct.includes("javascript") || ct.includes("json") || ct.includes("svg");

      if (isText) {
        let t = await store.get(k1, "text");
        if (t == null) t = await store.get(k2, "text");
        return t == null ? null : new Response(t, { headers: { "content-type": ct, "cache-control": "no-store" } });
      } else {
        let b = await store.get(k1, "arrayBuffer");
        if (!b) b = await store.get(k2, "arrayBuffer");
        return !b ? null : new Response(b, { headers: { "content-type": ct, "cache-control": "no-store" } });
      }
    }

    const resp = await getEither();
    if (resp) return resp;

    // якщо index не знайдено — лаконічна сторінка-заглушка
    if (path === "index.html" || path.endsWith("/index.html")) {
      const note = `<h1 style="font-family:sans-serif">Repo: файл не знайдено</h1>
<p>Шукано <code>code:${esc(path)}</code> або <code>${esc(path)}</code> у ${esc(nsName)}.</p>`;
      return H(`<!doctype html><meta charset="utf-8"><title>Not found</title>${note}`, 404);
    }
    return J({ ok: false, error: "Not found", path }, 404);
  }

  // ── Архіви (твоя існуюча логіка) ──

  // GET /admin/repo/html — сторінка зі списком архівів
  if (p === "/admin/repo/html" && req.method === "GET") {
    if (!ensureSecret(env, url)) return J({ ok: false, error: "unauthorized" }, 401);
    try {
      return H(await htmlList(env, url));
    } catch (e) {
      console.error("[repo.html]", e?.message || e);
      return J({ ok: false, error: String(e) }, 500);
    }
  }

  // POST /admin/repo/upload — завантаження архіву (ZIP)
  if (p === "/admin/repo/upload" && req.method === "POST") {
    if (!ensureSecret(env, url)) return J({ ok: false, error: "unauthorized" }, 401);
    try {
      const form = await req.formData();
      const f = form.get("file");
      if (!f || !f.name || !f.arrayBuffer) {
        return J({ ok: false, error: "file missing" }, 400);
      }

      const buf = new Uint8Array(await f.arrayBuffer());
      const b64 = bytesToBase64(buf);

      // ключ: senti_archive/YYYY-MM-DD__<filename>
      const datePart = new Date().toISOString().slice(0, 10);
      const key = `senti_archive/${datePart}__${f.name}`;

      await saveArchive(env, key, b64);
      await appendChecklist(env, `📦 upload success → ${key}`);

      const st = await runSelfTestLocalDirect(env).catch(() => ({ ok: false }));
      if (st?.ok) {
        await setCurrent(env, key, "upload");
        return J({ ok: true, uploaded: key, auto_promoted: true, selftest: true });
      } else {
        await appendChecklist(env, `⚠️ upload done, but selftest failed → ${key}`);
        return H(await htmlList(env, url));
      }
    } catch (e) {
      console.error("[repo.upload]", e?.message || e);
      await appendChecklist(env, `❌ upload error: ${String(e)}`);
      return J({ ok: false, error: String(e) }, 500);
    }
  }

  // GET /admin/repo/auto-promote[?key=] — ручний авто-промоут
  if (p === "/admin/repo/auto-promote" && req.method === "GET") {
    if (!ensureSecret(env, url)) return J({ ok: false, error: "unauthorized" }, 401);
    const key = url.searchParams.get("key");
    try {
      const items = await listArchives(env);
      const chosen = key || items[0];
      if (!chosen) return J({ ok: false, error: "no archives" }, 400);

      const st = await runSelfTestLocalDirect(env).catch(() => ({ ok: false }));
      if (!st?.ok) {
        await appendChecklist(env, `⚠️ auto-promote skipped (selftest fail) → ${chosen}`);
        return J({ ok: false, error: "selftest failed", key: chosen }, 409);
      }

      await setCurrent(env, chosen, key ? "button" : "latest");
      return J({ ok: true, promoted: chosen, by: key ? "button" : "latest" });
    } catch (e) {
      console.error("[repo.auto-promote]", e?.message || e);
      await appendChecklist(env, `❌ auto-promote error: ${String(e)}`);
      return J({ ok: false, error: String(e) }, 500);
    }
  }

  // не наш маршрут
  return null;
}