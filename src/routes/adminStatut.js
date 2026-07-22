// src/routes/adminStatut.js
import { writeStatut, statutHtml } from "../lib/kvChecklist.js";
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

function isStatutPath(path) {
  return path === "/admin/statut" || path === "/admin/statut/html";
}

export async function handleAdminStatut(req, env, url) {
  const path = (url.pathname || "").replace(/\/+$/, "") || "/";
  if (!isStatutPath(path)) return null;

  if (!isAuthorized(req, env, url)) {
    return json({ ok: false, error: "unauthorized" }, 401, CORS);
  }

  if (req.method === "GET") {
    return html(await statutHtml(env));
  }

  if (req.method !== "POST" || path !== "/admin/statut") {
    return json({ ok: false, error: "method not allowed" }, 405, CORS);
  }

  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  let text = "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    text = String(body.text || "");
  } else if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await req.formData().catch(() => null);
    text = String(form?.get("text") || "");
  } else {
    text = await req.text().catch(() => "");
  }

  await writeStatut(env, text);
  return json({ ok: true, saved: true }, 200, CORS);
}
