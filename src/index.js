import webhook from "./routes/webhook.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // === WEBHOOK ===
    if (path === "/webhook" && request.method === "POST") {
      return await webhook(request, env, ctx);
    }

    // === HEALTH CHECK ===
    if (path === "/ping") {
      return new Response("pong 🟢", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }

    // === DEFAULT RESPONSE ===
    return new Response("Senti Worker Active", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  },
};
