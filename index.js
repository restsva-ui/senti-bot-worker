// index.js — Senti Bot Worker (Cloudflare Workers)

// Допоміжні відповіді
const text = (body, status = 200, extra = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extra },
  });

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

// CORS (за потреби можна обмежити origin)
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type, x-telegram-bot-api-secret-token",
};

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const { pathname } = url;

      // Прості CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }

      // 1) Healthcheck
      if (request.method === "GET" && pathname === "/health") {
        return text("ok", 200, CORS_HEADERS);
      }

      // 2) Головна — коротка довідка
      if (request.method === "GET" && pathname === "/") {
        const info = [
          "Senti Bot Worker is up ✅",
          "Routes:",
          "  GET  /health           -> 200 ok",
          "  POST /webhook          -> Telegram webhook endpoint",
          "",
          "Env vars expected:",
          "  TELEGRAM_BOT_TOKEN  (required)",
          "  WEBHOOK_SECRET      (required)",
        ].join("\n");
        return text(info, 200, CORS_HEADERS);
      }

      // 3) Telegram webhook
      if (request.method === "POST" && pathname === "/webhook") {
        // Перевірка секрету з заголовка
        const headerSecret =
          request.headers.get("x-telegram-bot-api-secret-token") ||
          request.headers.get("X-Telegram-Bot-Api-Secret-Token"); // на всяк випадок

        if (!env.WEBHOOK_SECRET) {
          return json(
            { ok: false, error: "WEBHOOK_SECRET is not set in environment" },
            500,
            CORS_HEADERS
          );
        }
        if (headerSecret !== env.WEBHOOK_SECRET) {
          return json({ ok: false, error: "Forbidden" }, 403, CORS_HEADERS);
        }

        if (!env.TELEGRAM_BOT_TOKEN) {
          return json(
            { ok: false, error: "TELEGRAM_BOT_TOKEN is not set in environment" },
            500,
            CORS_HEADERS
          );
        }

        // Парсимо апдейт
        let update;
        try {
          update = await request.json();
        } catch {
          return json({ ok: false, error: "Invalid JSON" }, 400, CORS_HEADERS);
        }

        // Дістаємо текст повідомлення (якщо є)
        const message = update.message || update.edited_message || null;
        const chatId = message?.chat?.id;
        const incomingText = message?.text?.trim() ?? "";

        // Нічого відповідати, якщо немає chatId
        if (!chatId) {
          // Telegram очікує 200 швидко — навіть якщо нічого не робимо
          return json({ ok: true, skipped: true }, 200, CORS_HEADERS);
        }

        // Проста логіка:
        // /start -> вітання
        // інакше echo
        let replyText = "Я живий 🙂 Надішли /start або будь-який текст.";
        if (incomingText === "/start") {
          replyText =
            "Привіт! Це Senti Bot на Cloudflare Workers.\n" +
            "Напиши мені щось — я повторю 👇";
        } else if (incomingText.length > 0) {
          replyText = `Ти написав: “${incomingText}”`;
        }

        // Відправляємо відповідь у Telegram
        const tgUrl = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const payload = {
          chat_id: chatId,
          text: replyText,
          parse_mode: "HTML",
        };

        // Не блокуємо відповідь Telegram — відправку робимо у бекграунді
        ctx.waitUntil(
          fetch(tgUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }).then(async (r) => {
            if (!r.ok) {
              const body = await r.text().catch(() => "");
              console.error("Telegram API error:", r.status, body);
            }
          })
        );

        // Telegram повинен миттєво отримати 200, інакше він ретраїть
        return json({ ok: true }, 200, CORS_HEADERS);
      }

      // 4) Неіснуючі маршрути
      return text("Not found", 404, CORS_HEADERS);
    } catch (err) {
      console.error("Unhandled error:", err);
      return json({ ok: false, error: "Internal error" }, 500, CORS_HEADERS);
    }
  },
};