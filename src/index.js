import { handleUpdate } from "./router.js";

/**
 * Telegram надсилає POST на твій /<secret-path> (або /webhook у тебе раніше).
 * Ми приймаємо лише POST, перевіряємо секретний токен заголовком (якщо задано).
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // health/ok
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/ok")) {
      return new Response("ok", { status: 200 });
    }

    // Приймаємо webhook лише на SECRET-шляху, якщо WEBHOOK_SECRET заданий
    const expectPath = env.WEBHOOK_SECRET ? `/${env.WEBHOOK_SECRET}` : "/webhook";
    if (url.pathname !== expectPath) {
      return new Response("Not Found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // Додаткова перевірка сигнатури з боку Telegram (необов'язково, але корисно)
    const headerTok = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (env.WEBHOOK_SECRET && headerTok && headerTok !== env.WEBHOOK_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const update = await request.json();
      await handleUpdate(update, env);
      return new Response("OK", { status: 200 });
    } catch (e) {
      return new Response("Bad Request", { status: 400 });
    }
  },
};