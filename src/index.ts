// src/index.ts
import { handleUpdate } from "./router";

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname;

      // проста перевірка живості
      if (request.method === "GET" && (pathname === "/" || pathname === "/health")) {
        return new Response("OK", { status: 200 });
      }

      // вебхук: дозволяємо будь-який суфікс /webhook/*
      if (pathname.startsWith("/webhook")) {
        if (request.method !== "POST") {
          return new Response(JSON.stringify({ ok: false, error: "Method must be POST" }), {
            headers: { "content-type": "application/json" },
            status: 405,
          });
        }
        const update = await request.json();
        return await handleUpdate(update);
      }

      return new Response("Not found", { status: 404 });
    } catch (err: any) {
      console.error("UNHANDLED_ERROR", { message: err?.message, stack: err?.stack });
      return new Response(JSON.stringify({ ok: false, error: "Internal Error" }), {
        headers: { "content-type": "application/json" },
        status: 500,
      });
    }
  },
};