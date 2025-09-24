// Точка входу Worker. Мінімум логіки — перевірка секрету і делегування в router.

import { handleUpdate } from "./core/router.js";

function ok(text = "ok") {
  return new Response(text, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}
function bad(status = 400, text = "bad request") {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Healthchecks / браузером відкрили воркера
    if (request.method === "GET") return ok("ok");

    // Приймаємо Telegram webhook (POST)
    if (request.method !== "POST") return bad(405, "method not allowed");

    // Перевірка секрету Telegram (X-Telegram-Bot-Api-Secret-Token)
    const got = request.headers.get("x-telegram-bot-api-secret-token");
    const need = env.WEBHOOK_SECRET;
    if (!need) return bad(500, "WEBHOOK_SECRET is not set");
    if (got !== need) return bad(403, "forbidden");

    // Читаємо апдейт
    let update;
    try {
      update = await request.json();
    } catch {
      return bad(400, "invalid json");
    }

    // Обробляємо апдейт (не блокуємо відповідь Telegram — fire-and-forget)
    ctx.waitUntil(handleUpdate(update, env).catch(console.error));

    // Telegram очікує 200 швидко
    return ok();
  },
};