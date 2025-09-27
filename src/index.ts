// src/index.ts

const WEBHOOK_PATH = "/webhook/senti1984";

export default {
  async fetch(request: Request, env: any, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // простий healthcheck
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response("ok", { status: 200 });
    }

    // основний вебхук
    if (request.method === "POST" && url.pathname === WEBHOOK_PATH) {
      let update: any;
      try {
        update = await request.json();
      } catch {
        return new Response("bad json", { status: 400 });
      }

      // Акуратно викликаємо існуючий роутер:
      // спочатку шукаємо named export handleUpdate,
      // якщо нема — default (щоб не зламати поточну структуру)
      try {
        const mod: any = await import("./router");
        if (typeof mod?.handleUpdate === "function") {
          await mod.handleUpdate(update, env);
        } else if (typeof mod?.default === "function") {
          await mod.default(update, env);
        }
      } catch (e) {
        // повертаємо 200, щоб Telegram не дудосив ретраями,
        // але лог Worker’а збере stack
        console.error("router error:", e);
        return new Response("ok", { status: 200 });
      }

      return new Response("ok", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
};