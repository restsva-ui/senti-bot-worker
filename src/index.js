import webhook from "./routes/webhook.js";
import { loadTodos, formatTodos } from "./lib/todo.js";

// простий текстовий респонс
function textResponse(text, status = 200, type = "text/plain") {
  return new Response(text, { status, headers: { "content-type": type } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Webhook
    if (path === "/webhook" && request.method === "POST") {
      return await webhook(request, env, ctx);
    }

    // KV self-test
    if (path === "/kvtest") {
      try {
        const k = "kvtest:" + crypto.randomUUID();
        await env.STATE_KV.put(k, "ok", { expirationTtl: 60 });
        const v = await env.STATE_KV.get(k);
        return textResponse(v ? "KV OK" : "KV FAIL");
      } catch {
        return textResponse("KV ERROR", 500);
      }
    }

    // експорт todo (для власника/інтеграцій)
    if (path === "/todo.json" && request.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key || key !== (env.WEBHOOK_SECRET ?? "")) {
        return textResponse("forbidden", 403);
      }
      const ownerId = env.OWNER_ID;
      const list = await loadTodos(env, ownerId);
      return textResponse(JSON.stringify({ items: list }), 200, "application/json; charset=utf-8");
    }

    // імпорт todo масивом
    if (path === "/todo.import" && request.method === "POST") {
      const key = url.searchParams.get("key");
      if (!key || key !== (env.WEBHOOK_SECRET ?? "")) {
        return textResponse("forbidden", 403);
      }
      let payload = {};
      try { payload = await request.json(); } catch {}
      const items = Array.isArray(payload.items) ? payload.items : [];
      const list = items.map((t) => ({ text: String(t), ts: Date.now() }));
      await env.TODO_KV.put(`todo:${env.OWNER_ID}`, JSON.stringify(list));
      return textResponse("ok");
    }

    if (path === "/ping") return textResponse("pong 🟢");
    return textResponse("Senti Worker Active");
  },

  // щоденний дайджест у чат власника
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const list = await loadTodos(env, env.OWNER_ID);
        if (!list.length) return;
        const date = new Date().toLocaleString("uk-UA", { timeZone: env.TZ ?? "Europe/Kyiv" });
        const text = `🗓 *Щоденний чек-лист* (${date})\n\n${formatTodos(list)}`;
        const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
        await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: env.OWNER_ID,
            text,
            parse_mode: "Markdown",
            disable_web_page_preview: true
          }),
        });
      } catch (_) {}
    })());
  }
};