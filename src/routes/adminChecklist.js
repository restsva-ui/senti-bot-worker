// src/routes/adminChecklist.js
import { checklistHtml, readChecklist, writeChecklist, appendChecklist, saveArchive } from "../lib/kvChecklist.js";
import { html, json, CORS } from "../utils/http.js";

export async function handleAdminChecklist(req, env, url) {
  if (url.pathname === "/admin/checklist" && req.method === "GET") {
    return html(await checklistHtml(env));
  }
  if (url.pathname === "/admin/checklist" && req.method === "POST") {
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
      return json({ ok: true, replaced: true }, 200, CORS);
    }
    if (params.has("append")) {
      await appendChecklist(env, body.line || body.text || "");
      return json({ ok: true, appended: true }, 200, CORS);
    }
    if (params.has("archive")) {
      await saveArchive(env, "manual");
      return json({ ok: true, archived: true }, 200, CORS);
    }
    return json({ ok: false, error: "unknown action" }, 400, CORS);
  }
  return null; // let router continue
}