// src/routes/adminStatut.js
// Сторінка редагування Статуту (HTML) + збереження.

import { readStatut, writeStatut, statutHtml } from "../lib/kvChecklist.js";
import { html, json, CORS } from "../utils/http.js";

/** Підтримуємо обидва URL на випадок старих лінків */
function isStatutViewPath(p) {
  return p === "/admin/statut" || p === "/admin/statut/html";
}

export async function handleAdminStatut(req, env, url) {
  const p = (url.pathname || "").replace(/\/+$/, "");

  // GET -> показати HTML-редактор статуту
  if (isStatutViewPath(p) && req.method === "GET") {
    return html(await statutHtml(env));
  }

  // POST -> зберегти статут
  if (p === "/admin/statut" && req.method === "POST") {
    // Приймаємо і form-urlencoded, і JSON
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    let body = {};
    if (ct.includes("application/json")) {
      body = await req.json().catch(() => ({}));
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const f = await req.formData();
      body = { text: String(f.get("text") || "") };
    } else {
      // спробуємо як JSON на всякий
      body = await req.json().catch(() => ({}));
    }

    await writeStatut(env, body.text || "");
    return json({ ok: true, saved: true }, 200, CORS);
  }

  return null; // не наш маршрут
}