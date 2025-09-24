import { handleUpdate } from "./router.js";

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/senti1984") {
        let raw = "";
        try {
          raw = await request.text(); // читаємо як текст для логів
        } catch (e) {
          console.error("Read body error:", e?.message);
        }

        let update = null;
        try {
          update = raw ? JSON.parse(raw) : null;
        } catch (e) {
          console.error("Bad JSON from TG:", e?.message, raw?.slice(0, 200));
          return new Response("ok", { status: 200 });
        }

        try {
          console.info("TG update keys:", ...Object.keys(update ?? {}));
        } catch {}

        try {
          await handleUpdate(update, env, ctx);
        } catch (e) {
          console.error("handleUpdate error:", e?.message);
        }

        return new Response("ok", { status: 200 });
      }

      if (request.method === "GET") {
        return new Response("Senti worker is running", { status: 200 });
      }

      return new Response("not found", { status: 404 });
    } catch (e) {
      console.error("fetch fatal:", e?.message);
      return new Response("ok", { status: 200 });
    }
  },
};