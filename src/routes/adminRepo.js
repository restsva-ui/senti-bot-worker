// src/routes/adminRepo.js
import { listArchives, getArchive, deleteArchive } from "../lib/kvChecklist.js";
import { html, json } from "../utils/respond.js";
import { abs } from "../utils/url.js";

/**
 * Адмін-інтерфейс для архівів (Repo)
 * GET /admin/repo/html, /admin/archive/get, /admin/archive/delete
 */
export async function handleAdminRepo(req, env, url) {
  const p = url.pathname;
  const needSecret = () =>
    env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

  if (p === "/admin/repo/html") {
    if (needSecret()) return html("<h3>401</h3>");
    const keys = await listArchives(env);
    const withSec = (base, hasQuery = false) =>
      !env.WEBHOOK_SECRET
        ? base
        : base + (hasQuery ? "&" : "?") + "s=" + encodeURIComponent(env.WEBHOOK_SECRET);

    const list =
      keys
        .map((k) => {
          const key = encodeURIComponent(k);
          const hrefGet = withSec(`/admin/archive/get?key=${key}`, true);
          const hrefDel = withSec(`/admin/archive/delete?key=${key}`, true);
          return `<li><a href="${hrefGet}">${k}</a> — <a href="${hrefDel}" onclick="return confirm('Delete?')">🗑</a></li>`;
        })
        .join("") || "<li>Порожньо</li>";

    const backChecklist = withSec("/admin/checklist/html");
    return html(`<!doctype html><meta charset="utf-8"><title>Repo</title>
    <div style="font-family:system-ui;margin:20px;max-width:900px">
      <h2>📚 Архів (Repo)</h2>
      <p><a href="${backChecklist}">⬅ До Checklist</a></p>
      <ul>${list}</ul>
    </div>`);
  }

  if (p === "/admin/archive/get") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);
    const key = url.searchParams.get("key");
    if (!key) return json({ ok: false, error: "key required" }, 400);
    const b64 = await getArchive(env, key);
    if (!b64) return json({ ok: false, error: "not found" }, 404);
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new Response(bin, {
      headers: { "content-type": "application/octet-stream" },
    });
  }

  if (p === "/admin/archive/delete") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);
    const key = url.searchParams.get("key");
    if (!key) return json({ ok: false, error: "key required" }, 400);
    await deleteArchive(env, key);
    return Response.redirect(
      abs(env, `/admin/repo/html${env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(env.WEBHOOK_SECRET)}` : ""}`),
      302
    );
  }

  return null; // не цей маршрут
}