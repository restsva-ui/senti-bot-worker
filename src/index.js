//////////////////////////////
// Senti-Lite 2025
// Worker Entry Point
//////////////////////////////

import { handleWebhook } from "./src/webhook.js";
import { serveWebApp } from "./src/ui/home.js";
import { json } from "./src/lib/utils.js";

// головний роутер
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Mini-App фронтенд
    if (url.pathname.startsWith("/app")) {
      return await serveWebApp(request, env, ctx);
    }

    // Webhook (Telegram)
    if (url.pathname === "/webhook") {
      if (request.method !== "POST")
        return json({ ok: false, error: "POST only" }, 405);

      return await handleWebhook(request, env, ctx);
    }

    return new Response("Senti-Lite Worker OK", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  },
};
