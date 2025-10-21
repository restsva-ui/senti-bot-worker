// src/routes/adminChecklist.js
// Checklist HTML + API (replace/append/archive) з авторизацією через ?s=...

import {
  checklistHtml,
  readChecklist,
  writeChecklist,
  appendChecklist,
  saveArchive
} from "../lib/kvChecklist.js";
import { html, json, CORS } from "../utils/http.js";

// універсальна перевірка секрету
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

export async function handleAdminChecklist(req, env, url) {
  // GET /admin/checklist/html  — HTML-сторінка чекліста (звична адреса)
  if (req.method === "GET" && url.pathname === "/admin/checklist/html") {
    if (!isAuthed(url, env)) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    return html(await checklistHtml(env));
  }

  // GET /admin/checklist — залишив сумісність (деякі лінки могли так викликати)
  if (req.method === "GET" && url.pathname === "/admin/checklist") {
    if (!isAuthed(url, env)) return json({ ok: false, error: "unauthorized" }, { status: 401 });
    return html(await checklistHtml(env));
  }

  // POST /admin/checklist?action=replace|append|archive
  if (req.method === "POST" && url.pathname === "/admin/checklist") {
    if (!isAuthed(url, env)) return json({ ok: false, error: "unauthorized" }, { status: 401 });

    const params = url.searchParams;
    const ct = req.headers.get("content-type") || "";
    let body = {};
    if (ct.includes("application/json")) {
      body = await req.json().catch(() => ({}));
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const f = await req.formData();
      body = Object.fromEntries([...f.entries()]);
    } else {
      const text = await req.text().catch(() => "");
      if (text) {
        try { body = JSON.parse(text); } catch { body = { text }; }
      }
    }

    if (params.has("replace")) {
      await writeChecklist(env, body.text || "");
      return json({ ok: true, replaced: true }, { status: 200, headers: CORS.headers });
    }
    if (params.has("append")) {
      await appendChecklist(env, body.line || body.text || "");
      return json({ ok: true, appended: true }, { status: 200, headers: CORS.headers });
    }
    if (params.has("archive")) {
      await saveArchive(env, "manual");
      return json({ ok: true, archived: true }, { status: 200, headers: CORS.headers });
    }
    return json({ ok: false, error: "unknown_action" }, { status: 400, headers: CORS.headers });
  }

  return null; // нехай інші роутери спробують
}