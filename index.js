// index.js — стабільний entry-point для Cloudflare Workers + Telegram webhook

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const isGET = request.method === "GET";
    const isPOST = request.method === "POST";

    // Усі потрібні змінні. (Додай їх у Secrets/Variables воркера)
    const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || "";
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET || "";

    // Допоміжні відповіді
    const json = (obj, status = 200, headers = {}) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...headers },
      });
    const text = (str, status = 200) =>
      new Response(str, {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });

    // Проста домашня сторінка
    if (isGET && (path === "/" || path === "")) {
      return text("Senti worker is alive. Try /health or POST /webhook");
    }

    // Healthcheck
    if (isGET && path === "/health") {
      return json({
        ok: true,
        name: "senti-bot-worker",
        time: new Date().toISOString(),
      });
    }

    // (Опційно) ручна реєстрація вебхука:
    // GET /set-webhook?url=https://<your-subdomain>.workers.dev/webhook
    if (isGET && path === "/set-webhook") {
      if (!BOT_TOKEN) return json({ ok: false, error: "BOT_TOKEN is empty" }, 500);
      const hookUrl = url.searchParams.get("url");
      if (!hookUrl) return json({ ok: false, error: "Provide ?url=" }, 400);
      const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
        method: "POST",
        body: new URLSearchParams({
          url: hookUrl,
          secret_token: WEBHOOK_SECRET || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      return json({ ok: true, telegram: data });
    }

    // Основний вебхук Telegram
    if (isPOST && path === "/webhook") {
      // Перевіряємо секрет від Telegram
      const incomingSecret =
        request.headers.get("x-telegram-bot-api-secret-token") || "";
      if ((WEBHOOK_SECRET || "") !== (incomingSecret || "")) {
        return json({ ok: false, error: "Forbidden (bad secret)" }, 403);
      }

      // Без токена далі сенсу немає
      if (!BOT_TOKEN) {
        return json({ ok: false, error: "BOT_TOKEN is not set" }, 500);
      }

      let update;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "Invalid JSON" }, 400);
      }

      // Витягуємо текст і chat_id
      const msg = update?.message || update?.edited_message;
      const chatId = msg?.chat?.id;
      const textIn = (msg?.text || "").trim();

      // Якщо нема чату — просто підтверджуємо отримання
      if (!chatId) return json({ ok: true, received: true });

      // Сформуємо відповідь
      let reply = "Я на звʼязку ✅";
      if (textIn === "/start") {
        reply =
          "Привіт! Це Senti бот на Cloudflare Workers. Напиши мені щось ✍️";
      } else if (textIn) {
        reply = `Ти написав: «${textIn}»`;
      }

      // Відповідаємо користувачу
      const tgRes = await fetch(
        `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: reply,
            parse_mode: "HTML",
          }),
        }
      );

      const tgJson = await tgRes.json().catch(() => ({}));
      return json({ ok: true, delivered: tgJson });
    }

    // 404 для всього іншого
    return json({ ok: false, error: "Not Found", path }, 404);
  },
};
```0