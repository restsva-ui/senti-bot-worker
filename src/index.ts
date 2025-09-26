// src/index.ts
import { setEnv } from "./config";
import { handleUpdate } from "./router";

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    try {
      // ініціалізація оточення на кожний запит
      setEnv(env);

      const url = new URL(request.url);

      // простий health-check
      if (request.method === "GET" && url.pathname === "/") {
        return new Response("OK", { status: 200 });
      }

      // Webhook від Telegram
      if (request.method === "POST" && url.pathname.startsWith("/webhook")) {
        const update = await request.json<any>();
        await handleUpdate(update);
        return new Response("ok", { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    } catch (err: any) {
      console.error("Worker fatal error:", err);
      return new Response("Internal error", { status: 500 });
    }
  },
} satisfies ExportedHandler;