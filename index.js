export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Healthcheck
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // Debug endpoint — покаже останній апдейт
    if (url.pathname === "/debug") {
      return new Response(
        JSON.stringify(
          { lastUpdate: globalThis.lastUpdate || null },
          null,
          2
        ),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Telegram webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        // Перевірка секрету
        const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
        if (secretHeader !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 403 });
        }

        const update = await request.json();

        // Логування у пам’ять воркера
        globalThis.lastUpdate = update;
        console.log("Got update:", JSON.stringify(update));

        // Якщо є повідомлення — відповідаємо
        if (update.message) {
          const chatId = update.message.chat.id;
          const text = "✅ Бот працює! Твоє повідомлення отримано.";

          await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text }),
          });
        }

        return new Response("OK", { status: 200 });
      } catch (err) {
        console.error("Webhook error:", err);
        return new Response("Internal Server Error", { status: 500 });
      }
    }

    return new Response("Not found", { status: 404 });
  },
};