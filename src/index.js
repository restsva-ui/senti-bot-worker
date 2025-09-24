import { handleUpdate } from "./router.js";

export default {
  async fetch(request, env, ctx) {
    try {
      // Проста перевірка методу/шляху
      const url = new URL(request.url);
      const isWebhookPath = url.pathname === "/senti1984";

      if (request.method === "POST" && isWebhookPath) {
        // TG шле JSON
        let update = null;
        try {
          update = await request.json();
        } catch (e) {
          console.error("Bad JSON from TG:", e?.message);
          return new Response("bad json", { status: 200 }); // 200 щоб TG не ретраїв
        }

        // Легкий heartbeat у логи — які ключі прийшли
        try {
          console.info("TG update keys:", ...Object.keys(update ?? {}));
        } catch {}

        // Головний роутер
        try {
          await handleUpdate(update, env, ctx);
        } catch (e) {
          console.error("handleUpdate error:", e?.message);
        }

        // TG очікує тільки 200/OK
        return new Response("ok", { status: 200 });
      }

      // Для GET/інших — технічний ping, щоб бачити, що воркер живий
      if (request.method === "GET") {
        return new Response("Senti worker is running", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error("fetch root error:", e?.message);
      return new Response("ok", { status: 200 });
    }
  },
};