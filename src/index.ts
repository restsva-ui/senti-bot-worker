import { handleUpdate } from "./router";
import type { Env } from "./config";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
      return new Response(JSON.stringify({ ok: true, service: "senti-bot-worker" }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (request.method === "POST" && url.pathname === "/webhook/senti1984") {
      const update = await request.json().catch(() => ({}));
      handleUpdate(update, env).catch(() => {});
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;