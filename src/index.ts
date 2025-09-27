// src/index.ts

const WEBHOOK_PATH = "/webhook/senti1984";

function isWebhookPath(pathname: string): boolean {
  // приймаємо /webhook/senti1984 і /webhook/senti1984/
  if (pathname === WEBHOOK_PATH) return true;
  if (pathname === WEBHOOK_PATH + "/") return true;
  return false;
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);

    // health
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response("ok", { status: 200 });
    }

    // webhook – відповідаємо 200 на будь-який метод, щоб Telegram не бачив 404
    if (isWebhookPath(url.pathname)) {
      let update: any = null;

      if (request.method === "POST") {
        try {
          update = await request.json();
        } catch (e) {
          // некоректний json — все одно 200, щоб Telegram не ретраїв
          console.error("bad json on webhook:", e);
          return new Response("ok", { status: 200 });
        }
      }

      try {
        // Акуратний виклик існуючого роутера: спершу handleUpdate, інакше default
        const mod: any = await import("./router");
        const fn =
          typeof mod?.handleUpdate === "function"
            ? mod.handleUpdate
            : typeof mod?.default === "function"
            ? mod.default
            : null;

        if (fn && update) {
          await fn(update, env);
        }
      } catch (e) {
        console.error("router error:", e);
        // все одно 200 — не ламаємо доставку апдейта
        return new Response("ok", { status: 200 });
      }

      return new Response("ok", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
};