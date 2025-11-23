// src/index.js — Senti-Lite 2025 entry

import { handleWebhook } from "./routes/webhook.js";
import { serveWebApp } from "./ui/home.js";
import { json } from "./lib/utils.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "POST only" }, 405);
      }
      return handleWebhook(request, env, ctx);
    }

    if (url.pathname.startsWith("/app")) {
      return serveWebApp(request, env, ctx);
    }

    return new Response("Senti-Lite Worker OK", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
