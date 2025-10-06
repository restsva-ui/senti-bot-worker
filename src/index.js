import webhook from "./routes/webhook.js";
import { loadTodos, formatTodos } from "./lib/todo.js";
import { syncOnce } from "./lib/checklist-manager.js";

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

    // Ручний sync через HTTP (для мене/скриптів)
    // GET /sync?key=WEBHOOK_SECRET
    if (path === "/sync" && request.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key || key !== (env.WEBHOOK_SECRET ?? "")) return textResponse("forbidden", 403);
      const { changed, addedRules, count } = await syncOnce(env, env.OWNER_ID);
      return textResponse(JSON.stringify({ ok: true, changed, addedRules, count }), 200, "application/json; charset=utf-8");
    }

    // Експорт todo
    if (path === "/todo.json" && request.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key || key !== (env.WEBHOOK_SECRET ?? "")) return textResponse("forbidden", 403);
      const list = await loadTodos(env, env.OWNER_ID);
      return textResponse(JSON.stringify({ items: list }), 200, "application/json; charset=utf-8");
    }

    // Імпорт todo
    if (path === "/todo.import" && request.method === "POST") {
      const key = url.searchParams.get("key");
      if (!key || key !== (env.WEBHOOK_SECRET ?? "")) return textResponse("forbidden", 403);
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

  // ⏰ Cron: кожні 15 хв — м'який фоновий sync
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const { changed, addedRules } = await syncOnce(env, env.OWNER_ID);
        // за бажанням — можна присилати короткий репорт у ТГ лише якщо були зміни
        if (changed && env.BOT_TOKEN && env.OWNER_ID) {
          const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
          const parts = [];
          if (addedRules?.length) parts.push("➕ Додав правила:\n" + addedRules.map((r) => `• ${r}`).join("\n"));
          const text = parts.length ? parts.join("\n\n") : "🔁 Синхронізація без змін.";
          await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ chat_id: env.OWNER_ID, text, disable_web_page_preview: true }),
          });
        }
      } catch (_) {}
    })());
  }
};