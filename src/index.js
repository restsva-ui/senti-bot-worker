// Cloudflare Worker entry
import { handleUpdate } from "./router.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (request.method === "POST" && url.pathname === "/senti1984") {
      // Verify secret header
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!secret || secret !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }

      const update = await request.json().catch(() => null);
      if (!update) return new Response("bad request", { status: 400 });

      // Fire & forget
      ctx.waitUntil(handleUpdate(update, env));
      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },
};