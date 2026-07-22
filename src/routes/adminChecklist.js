// src/routes/adminChecklist.js
import {
  checklistHtml,
  writeChecklist,
  appendChecklist,
  saveArchive,
} from "../lib/kvChecklist.js";
import { html, json, CORS } from "../utils/http.js";

function expectedSecret(env) {
  return env.ADMIN_SECRET || env.WEBHOOK_SECRET || "";
}

function isAuthorized(req, env, url) {
  const expected = expectedSecret(env);
  if (!expected) return false;

  const supplied =
    url.searchParams.get("s") ||
    req.headers.get("x-admin-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return supplied === expected;
}

export async function handleAdminChecklist(req, env, url) {
  const path = (url.pathname || "").replace(/\/+$/, "") || "/";
  if (path !== "/admin/checklist" && path !== "/admin/checklist/html") return null;

  if (!isAuthorized(req, env, url)) {
    return json({ ok: false, error: "unauthorized" }, 401, CORS);
  }

  if (req.method === "GET") {
    return html(await checklistHtml(env));
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405, CORS);
  }

  const params = url.searchParams;
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  let body = {};

  if (contentType.includes("application/json")) {
    body = await req.json().catch(() => ({}));
  } else if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await req.formData().catch(() => null);
    body = form ? Object.fromEntries(form.entries()) : {};
  } else {
    const raw = await req.text().catch(() => "");
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = { text: raw };
      }
    }
  }

  if (params.has("replace")) {
    await writeChecklist(env, String(body.text || ""));
    return json({ ok: true, replaced: true }, 200, CORS);
  }

  if (params.has("append")) {
    const line = String(body.line || body.text || "").trim();
    if (!line) return json({ ok: false, error: "empty line" }, 400, CORS);
    await appendChecklist(env, line);
    return json({ ok: true, appended: true }, 200, CORS);
  }

  if (params.has("archive")) {
    await saveArchive(env, "manual");
    return json({ ok: true, archived: true }, 200, CORS);
  }

  return json({ ok: false, error: "unknown action" }, 400, CORS);
}
