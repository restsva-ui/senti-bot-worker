import { routeUpdate } from "./router";
import { CFG } from "./config";

export default {
  async fetch(req: Request): Promise<Response> {
    // Healthcheck
    if (new URL(req.url).pathname === "/") {
      return new Response("OK");
    }

    // Верифікація секрету (опційно)
    if (CFG.WEBHOOK_SECRET) {
      const secret = new URL(req.url).searchParams.get("secret");
      if (secret !== CFG.WEBHOOK_SECRET) return new Response("Forbidden", { status: 403 });
    }

    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

    try {
      const update = await req.json();
      await routeUpdate(update);
      return new Response("OK");
    } catch (e:any) {
      // простий лог
      console.error("ERR:", e?.message || e);
      return new Response("Internal Error", { status: 500 });
    }
  }
} satisfies ExportedHandler;