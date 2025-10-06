import { json, notFound } from "./lib/resp.js";
import { handleHealth } from "./routes/health.js";
import { handleWebhook } from "./routes/webhook.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Маршрути
    if (request.method === "GET" && url.pathname === "/health") {
      return handleHealth(env);
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env);
    }

    return notFound();
  },
};