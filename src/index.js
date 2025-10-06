import webhook from "./routes/webhook.js";
import { loadTodos, formatTodos } from "./lib/todo.js";
import { getBaseSnapshot, setBaseSnapshot, getHistory, upsertSnapshotTodo } from "./lib/snapshot-manager.js";

function textResponse(text, status = 200, type = "text/plain") {
  return new Response(text, { status, headers: { "content-type": type } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Webhook від Telegram
    if (path === "/webhook" && request.method === "POST") {
      return await webhook(request, env, ctx);
    }

    // ---- Snapshot API (для мене/CI; захищено WEBHOOK_SECRET) ----

    // 1) Отримати поточний базовий снепшот + історію
    if (path === "/snapshot.json" && request.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key || key !== (env.WEBHOOK_SECRET ?? "")) return textResponse("forbidden", 403);
      const base = await getBaseSnapshot(env);
      const history = await getHistory(env);
      return textResponse(JSON.stringify({ base, history }), 200, "application/json; charset=utf-8");
    }

    // 2) Встановити/оновити базовий снепшот вручну (Drive або будь-який URL)
    //    POST /snapshot.set?key=SECRET  body: { sha?, url, note? }
    if (path === "/snapshot.set" && request.method === "POST") {
      const key = url.searchParams.get("key");
      if (!key || key !== (env.WEBHOOK_SECRET ?? "")) return textResponse("forbidden", 403);
      let payload = {};
      try { payload = await request.json(); } catch {}
      const sha = payload.sha ? String(payload.sha) : "";
      const urlIn = String(payload.url || "");
      const note = payload.note ? String(payload.note) : "manual set";
      const snap = await setBaseSnapshot(env, { sha, url: urlIn, note });

      // ⏫ оновити/додати пункт у чек-лісті
      await upsertSnapshotTodo(env, env.OWNER_ID, snap);

      return textResponse(JSON.stringify({ ok: true, snap }), 200, "application/json; charset=utf-8");
    }

    // 3) Гачок з GitHub Actions після успішного деплою
    //    GET /postdeploy?key=SECRET&repo=owner/name&sha=...
    if (path === "/postdeploy" && request.method === "GET") {
      const key = url.searchParams.get("key");
      if (!key || key !== (env.WEBHOOK_SECRET ?? "")) return textResponse("forbidden", 403);
      const repo = url.searchParams.get("repo") || "";
      const sha = url.searchParams.get("sha") || "";
      if (!repo || !sha) return textResponse("missing repo or sha", 400);

      const zipURL = `https://github.com/${repo}/archive/${sha}.zip`;
      const snap = await setBaseSnapshot(env, { sha, url: zipURL, note: "post-deploy snapshot" });

      // ⏫ оновити/додати пункт у чек-лісті
      await upsertSnapshotTodo(env, env.OWNER_ID, snap);

      return textResponse(JSON.stringify({ ok: true, snap }), 200, "application/json; charset=utf-8");
    }

    // ---- Допоміжні ендпоїнти, як були ----

    // Експорт todo (для інтеграцій)
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
};