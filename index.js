export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // health-check
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        return new Response("ok", { status: 200 });
      }

      if (url.pathname === "/webhook") {
        if (request.method !== "POST") {
          return new Response("ok", { status: 200 });
        }

        // 1) перевірка секрету вебхука (якщо заданий)
        const expected = env.WEBHOOK_SECRET;
        if (expected) {
          const got = request.headers.get("x-telegram-bot-api-secret-token");
          if (!got || got !== expected) {
            console.warn("Webhook secret mismatch or missing");
            return new Response("ok", { status: 200 });
          }
        }

        // 2) читаємо апдейт без падінь
        let update;
        try {
          update = await request.json();
        } catch (e) {
          console.error("JSON parse error:", e);
          return new Response("ok", { status: 200 });
        }

        console.log("Incoming update:", JSON.stringify(update));

        // 3) обробка message
        if (update.message) {
          const msg = update.message;
          const chatId = msg.chat?.id;
          if (!chatId) {
            console.warn("No chat id in update");
            return new Response("ok", { status: 200 });
          }

          // action: typing…
          await safeTg(env, "sendChatAction", { chat_id: chatId, action: "typing" });

          const text = (msg.text || "").trim();
          let reply;

          if (!text) {
            reply = "Я бачу твоє повідомлення 👀 Але тут немає тексту. Напиши щось 🙂";
          } else if (/^\/start\b/i.test(text)) {
            const name = msg.from?.first_name || "друже";
            reply = `Vitaliy, привіт! ✨ Я вже чекав нашої зустрічі!\n\nГотовий допомагати.`;
          } else if (/^\/setwebhook\b/i.test(text)) {
            reply = "Вебхук вже налаштований ✅";
          } else {
            // простий ехо + захист від довгих відповідей
            reply = `Ти написав: ${text}`;
          }

          await safeTg(env, "sendMessage", {
            chat_id: chatId,
            text: reply,
            parse_mode: "HTML",
            disable_web_page_preview: true
          });
        }

        // 4) обов’язково 200
        return new Response("ok", { status: 200 });
      }

      // інші маршрути
      return new Response("ok", { status: 200 });
    } catch (err) {
      // остання лінія оборони — лог і 200
      console.error("Top-level error:", err);
      return new Response("ok", { status: 200 });
    }
  }
};

// Безпечний виклик Telegram API з логами
async function safeTg(env, method, body) {
  const token = env.TELEGRAM_TOKEN;
  if (!token) {
    console.error("TELEGRAM_TOKEN is missing");
    return;
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      console.error("TG API error:", method, res.status, data);
    } else {
      console.log("TG API ok:", method, JSON.stringify(data));
    }
  } catch (e) {
    console.error("TG fetch error:", method, e);
  }
}
