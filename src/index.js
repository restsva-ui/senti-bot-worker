export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Healthcheck
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ ok: true, name: "senti-bot-worker" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // Telegram webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      const secret = url.searchParams.get("secret");
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 403 });
      }

      const update = await request.json();
      const chatId = update.message?.chat?.id;
      const text = update.message?.text;

      if (chatId && text) {
        const reply = `✅ Сенті онлайн!\nТи написав: "${text}"`;
        await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: reply }),
        });
      }

      return new Response("ok");
    }

    return new Response("Not found", { status: 404 });
  },
};