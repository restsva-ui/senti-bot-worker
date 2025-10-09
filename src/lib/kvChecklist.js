// src/lib/adminChecklist.js
// HTML-чекліст на KV + upload архівів у KV.
// Роутер максимально обгорнутий у try/catch, щоб не давати 1101.

import {
  readChecklist,
  writeChecklist,
  appendChecklist,
  saveArchive,
  checklistHtml,
} from "./kvChecklist.js";

function isAllowed(url, env) {
  const s = url.searchParams.get("s") || "";
  const byId = String(env.TELEGRAM_ADMIN_ID || "") === s;
  const bySecret = String(env.ADMIN_HTML_SECRET || "senti1984") === s;
  return byId || bySecret;
}

function backToHtml(url) {
  const s = url.searchParams.get("s") || "";
  return `/admin/checklist/html?s=${encodeURIComponent(s)}`;
}

export async function routeAdminChecklist(request, env, url) {
  try {
    const { pathname } = url;
    if (!pathname.startsWith("/admin/checklist")) return null;

    // доступ
    if (!isAllowed(url, env)) {
      return new Response("Forbidden (admin secret mismatch)", { status: 403 });
    }

    // GET /admin/checklist/html
    if (request.method === "GET" && pathname.endsWith("/html")) {
      const page = await checklistHtml(env, url.searchParams.get("s") || "");
      return new Response(page, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // POST /admin/checklist/append
    if (request.method === "POST" && pathname.endsWith("/append")) {
      const fd = await request.formData();
      const line =
        (fd.get("line") || "").toString().trim() ||
        `tick ${new Date().toISOString()}`;
      await appendChecklist(env, line);
      return Response.redirect(backToHtml(url), 302);
    }

    // POST /admin/checklist/save
    if (request.method === "POST" && pathname.endsWith("/save")) {
      const fd = await request.formData();
      await writeChecklist(env, fd.get("body") || "");
      return Response.redirect(backToHtml(url), 302);
    }

    // POST /admin/checklist/upload
    if (request.method === "POST" && pathname.endsWith("/upload")) {
      const fd = await request.formData();
      const f = fd.get("file");
      if (f && typeof f.arrayBuffer === "function") {
        await saveArchive(env, f);
        await appendChecklist(
          env,
          `archive: ${f.name || "file"} (${f.type || "application/octet-stream"}) @ ${new Date().toISOString()}`
        );
      }
      return Response.redirect(backToHtml(url), 302);
    }

    // інші під-рути: діагностика, щоб не було 1101
    if (request.method === "GET") {
      const text = await readChecklist(env);
      return new Response(
        JSON.stringify({ ok: true, bytes: text.length, note: "admin checklist endpoint" }),
        { headers: { "content-type": "application/json" } }
      );
    }

    return new Response("Method Not Allowed", { status: 405 });
  } catch (e) {
    return new Response(`Admin error:\n${e?.stack || e}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}