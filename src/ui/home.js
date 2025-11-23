//////////////////////////////
// home.js — видача Mini-App
//////////////////////////////

import { json } from "../lib/utils.js";

export async function serveWebApp(req, env) {
  const url = new URL(req.url);

  // статика
  if (url.pathname === "/app" || url.pathname === "/app/") {
    return new Response(await env.ASSETS.get("webapp/index.html"), {
      headers: { "content-type": "text/html" },
    });
  }

  if (url.pathname.endsWith(".css")) {
    return new Response(await env.ASSETS.get("webapp/style.css"), {
      headers: { "content-type": "text/css" },
    });
  }

  if (url.pathname.endsWith(".js")) {
    return new Response(await env.ASSETS.get("webapp/app.js"), {
      headers: { "content-type": "text/javascript" },
    });
  }

  // завантаження фото
  if (url.pathname === "/app/upload" && req.method === "POST") {
    const form = await req.formData();
    const file = form.get("file");

    const name = `upload/${Date.now()}-${file.name}`;
    await env.ASSETS.put(name, file);

    const publicUrl = `${env.APP_PUBLIC}/${name}`;
    return json({ url: publicUrl });
  }

  return json({ ok: false, error: "Not found" }, 404);
}
