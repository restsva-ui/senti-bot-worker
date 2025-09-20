// index.js
/**
 * Мінімальний стабільний воркер:
 *   GET  /          -> 200 "ok"
 *   GET  /health    -> 200 JSON
 *   POST /webhook   -> Telegram webhook (перевіряє secret header)
 *
 * Очікувані env:
 *   TELEGRAM_BOT_TOKEN
 *   WEBHOOK_SECRET
 */

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;

      if (request.method === "GET" && pathname === "/") {
        return new Response("ok", {
          status: 200,
          headers: { "content-type": "text/plain; charset=UTF-8" },
        });
      }

      if (request.method === "GET" && pathname === "/health") {
        const body = {
          ok: true,
          name: "senti-bot-worker",
          time: new Date().toISOString(),
          hasToken: Boolean(env.TELEGRAM_BOT_TOKEN),
          hasSecret: Boolean(env.WEBHOOK_SECRET),
        };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json; charset=UTF-8" },
        });
      }

      if (request.method === "POST" && pathname === "/webhook") {
        // Перевіряємо секрет з Telegram
        const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (!env.WEBHOOK_SECRET || got !== env.WEBHOOK_SECRET) {
          return new Response("forbidden", { status: 403 });
        }

        const update = await request.json().catch(() => null);
        if (!update || !env.TELEGRAM_BOT_TOKEN) {
          return new Response("bad request", { status: 400 });
        }

        const chatId =
          update?.message?.chat?.id ??
          update?.callback_query?.message?.chat?.id ??
          update?.my_chat_member?.chat?.id;

        // Проста логіка: відповідаємо на /start, /ping, /whoami
        const text = update?.message?.text || "";
        let reply = "👍 Привіт! Бот на Cloudflare Workers працює.";

        if (text.startsWith("/ping")) reply = "🏓 pong";
        else if (text.startsWith("/whoami"))
          reply = `👤 chat_id: ${chatId ?? "unknown"}`;
        else if (text.startsWith("/start"))
          reply =
            "🤖 Я готовий. Команди: /ping, /whoami. /health перевіряє стан воркера.";

        if (chatId) {
          await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, reply);
        }

        // Telegram очікує 200 швидко — не тягнемо довгі операції
        return new Response("ok", { status: 200 });
      }

      // 404 для решти
      return new Response("Not Found", {
        status: 404,
        headers: { "content-type": "text/plain; charset=UTF-8" },
      });
    } catch (err) {
      // Страхуємося від неочікуваних помилок
      return new Response("Internal Error", { status: 500 });
    }
  },
};

async function sendTelegram(token, chatId, text) {
  const api = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(api, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => {});
}