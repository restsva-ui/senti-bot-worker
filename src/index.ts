export default {
  async fetch(req: Request): Promise<Response> {
    try {
      const { pathname } = new URL(req.url);

      // 🔹 Лог для перевірки
      console.log("Incoming request:", pathname);

      // Якщо прилітає вебхук від Telegram
      if (pathname.startsWith("/webhook")) {
        console.log("Webhook received ✅");
        return new Response("ok", { status: 200 });
      }

      // Перевірка живості (health check)
      if (pathname === "/") {
        return new Response("Worker alive 🚀", { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("Error in fetch:", err);
      return new Response("Internal error", { status: 500 });
    }
  },
};