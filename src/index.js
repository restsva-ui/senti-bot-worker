export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // Root route
      if (url.pathname === "/") {
        return new Response("Hello from Worker!", { status: 200 });
      }

      // Webhook route
      if (url.pathname === `/webhook/${env.WEBHOOK_SECRET}` && request.method === "POST") {
        let update;
        try {
          update = await request.json();
        } catch (e) {
          console.error("❌ JSON parse error:", e);
          return new Response("Invalid JSON", { status: 200 }); // Telegram не повинен бачити 500
        }

        try {
          // Головна обробка апдейту
          if (update.message) {
            console.log("📩 New message:", update.message);

            if (update.message.text === "/ping") {
              await sendMessage(env.BOT_TOKEN, update.message.chat.id, "pong ✅");
            }

            if (update.message.text === "/start") {
              await sendMessage(
                env.BOT_TOKEN,
                update.message.chat.id,
                "👋 Привіт! Бот підключено до Cloudflare Workers."
              );
            }
          }

          if (update.callback_query) {
            console.log("🔘 Callback query:", update.callback_query);
          }
        } catch (err) {
          console.error("❌ Update handling error:", err);
        }

        return new Response("OK", { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      console.error("❌ Global error:", err);
      return new Response("Internal Error", { status: 200 }); // навіть глобальна помилка не ламає
    }
  },
};

// Допоміжна функція
async function sendMessage(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}