export default {
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      const update = await request.json();

      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        // ---- /start ----
        if (text === "/start") {
          return sendMessage(
            chatId,
            "👋 Привіт! Бот підключено до Cloudflare Workers.\n" +
            "Спробуй: /ping, напиши текст, або /kvset ключ значення, /kvget ключ"
          );
        }

        // ---- /ping ----
        if (text === "/ping") {
          return sendMessage(chatId, "pong ✅");
        }

        // ---- /menu ----
        if (text === "/menu") {
          const keyboard = {
            inline_keyboard: [
              [{ text: "👍 Панель лайків", callback_data: "likepanel" }],
              [{ text: "📊 Статистика", callback_data: "stats" }]
            ]
          };
          return sendMessage(chatId, "Оберіть дію:", keyboard);
        }

        // ---- /likepanel ----
        if (text === "/likepanel") {
          const keyboard = {
            inline_keyboard: [
              [{ text: "👍", callback_data: "like" }, { text: "👎", callback_data: "dislike" }]
            ]
          };
          return sendMessage(chatId, "Результат голосування:", keyboard);
        }

        // ---- /stats ----
        if (text === "/stats") {
          const likes = await env.KV.get("likes") || 0;
          const dislikes = await env.KV.get("dislikes") || 0;
          return sendMessage(
            chatId,
            `📊 Статистика чату:\n👍 Вподобайок: ${likes}\n👎 Дизлайків: ${dislikes}`
          );
        }

        // ---- /kvset ----
        if (text.startsWith("/kvset")) {
          const parts = text.split(" ");
          if (parts.length < 3) {
            return sendMessage(chatId, "Використання: /kvset <ключ> <значення>");
          }
          const key = parts[1];
          const value = parts.slice(2).join(" ");
          await env.KV.put(key, value);
          return sendMessage(chatId, `✅ Збережено: ${key} = ${value}`);
        }

        // ---- /kvget ----
        if (text.startsWith("/kvget")) {
          const parts = text.split(" ");
          if (parts.length < 2) {
            return sendMessage(chatId, "Використання: /kvget <ключ>");
          }
          const key = parts[1];
          const value = await env.KV.get(key);
          if (value === null) {
            return sendMessage(chatId, `❌ Немає даних для ключа: ${key}`);
          }
          return sendMessage(chatId, `📦 ${key} = ${value}`);
        }
      }

      // ---- callback_query ----
      if (update.callback_query) {
        const chatId = update.callback_query.message.chat.id;
        const data = update.callback_query.data;

        if (data === "like") {
          let likes = parseInt(await env.KV.get("likes") || "0", 10);
          likes++;
          await env.KV.put("likes", likes.toString());
          return sendMessage(chatId, "✅ Отримав оновлення.");
        }

        if (data === "dislike") {
          let dislikes = parseInt(await env.KV.get("dislikes") || "0", 10);
          dislikes++;
          await env.KV.put("dislikes", dislikes.toString());
          return sendMessage(chatId, "✅ Отримав оновлення.");
        }

        if (data === "stats") {
          const likes = await env.KV.get("likes") || 0;
          const dislikes = await env.KV.get("dislikes") || 0;
          return sendMessage(
            chatId,
            `📊 Статистика чату:\n👍 Вподобайок: ${likes}\n👎 Дизлайків: ${dislikes}`
          );
        }
      }

      return new Response("ok");
    }

    return new Response("Hello from Worker!");
  }
};

// ---- Helper для надсилання повідомлень ----
async function sendMessage(chatId, text, keyboard) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    parse_mode: "HTML"
  };
  if (keyboard) {
    body.reply_markup = keyboard;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return new Response("ok");
}