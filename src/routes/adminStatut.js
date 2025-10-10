// src/routes/adminStatut.js
import { readStatut, writeStatut, statutHtml } from "../lib/kvChecklist.js";
import { abs } from "../utils/url.js";

export async function handleAdminStatut(req, env, url) {
  const p = url.pathname;
  const needSecret = () =>
    env.WEBHOOK_SECRET && url.searchParams.get("s") !== env.WEBHOOK_SECRET;

  const html = (s) =>
    new Response(s, { headers: { "content-type": "text/html; charset=utf-8" } });
  const json = (o, status = 200) =>
    new Response(JSON.stringify(o, null, 2), {
      status,
      headers: { "content-type": "application/json" },
    });

  // HTML UI
  if (p === "/admin/statut/html") {
    if (needSecret()) return html("<h3>401</h3>");
    if (req.method === "POST") {
      const form = await req.formData();
      await writeStatut(env, String(form.get("full") ?? ""));
    }
    const text = await readStatut(env);
    return statutHtml({
      text,
      submitPath: abs(env, "/admin/statut/html"),
      secret: env.WEBHOOK_SECRET || "",
    });
  }

  // JSON API (опціонально)
  if (p === "/admin/statut") {
    if (needSecret()) return json({ ok: false, error: "unauthorized" }, 401);
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      await writeStatut(env, String(body.text ?? ""));
      return json({ ok: true });
    }
    const text = await readStatut(env);
    return json({ ok: true, text });
  }

  return null; // не наш маршрут
}