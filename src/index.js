export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const update = await request.json();
      if (update.message) {
        const chatId = update.message.chat.id;
        const text = update.message.text || "";

        switch (true) {
          case text === "/start":
            await sendMessage(chatId, "👋 Привіт! Бот підключено до Cloudflare Workers.\nСпробуй: /ping, /likepanel, /stats, /menu");
            break;

          case text === "/ping":
            await sendMessage(chatId, "pong ✅");
            break;

          case text.startsWith("/kvset"):
            {
              const parts = text.split(" ");
              if (parts.length >= 3) {
                const key = parts[1];
                const value = parts.slice(2).join(" ");
                await env.BOT_KV.put(key, value);
                await sendMessage(chatId, `✅ Збережено: ${key} = ${value}`);
              } else {
                await sendMessage(chatId, "Використання: /kvset <key> <value>");
              }
            }
            break;

          case text.startsWith("/kvget"):
            {
              const parts = text.split(" ");
              if (parts.length === 2) {
                const key = parts[1];
                const value = await env.BOT_KV.get(key);
                if (value) {
                  await sendMessage(chatId, `📦 ${key} = ${value}`);
                } else {
                  await sendMessage(chatId, `❌ Ключ '${key}' не знайдено`);
                }
              } else {
                await sendMessage(chatId, "Використання: /kvget <key>");
              }
            }
            break;

          case text === "/kvtest":
            await sendMessage(chatId, "⚡ KV тест працює!");
            break;

          case text === "/likepanel":
            await sendMessage(chatId, "👍👎 Голосуйте:", {
              reply_markup: {
                inline_keyboard: [
                  [{ text: "👍", callback_data: "like" }, { text: "👎", callback_data: "dislike" }]
                ]
              }
            });
            break;

          case text === "/stats":
            {
              const likes = (await env.BOT_KV.get("likes")) || 0;
              const dislikes = (await env.BOT_KV.get("dislikes")) || 0;
              await sendMessage(chatId, `📊 Статистика чату:\n👍 Вподобайок: ${likes}\n👎 Дизлайків: ${dislikes}`);
            }
            break;

          case text === "/menu":
            await sendMessage(chatId, "Оберіть дію:", {
              reply_markup: {
                keyboard: [
                  [{ text: "/likepanel" }, { text: "/stats" }]
                ],
                resize_keyboard: true,
                one_time_keyboard: true
              }
            });
            break;

          default:
            await sendMessage(chatId, "❔ Невідома команда. Використай /menu");
            break;
        }
      } else if (update.callback_query) {
        const chatId = update.callback_query.message.chat.id;
        const data = update.callback_query.data;

        if (data === "like") {
          let likes = parseInt((await env.BOT_KV.get("likes")) || "0") + 1;
          await env.BOT_KV.put("likes", likes);
          await sendMessage(chatId, `Результат голосування:\n👍 ${likes} 👎 ${(await env.BOT_KV.get("dislikes")) || 0}`);
        } else if (data === "dislike") {
          let dislikes = parseInt((await env.BOT_KV.get("dislikes")) || "0") + 1;
          await env.BOT_KV.put("dislikes", dislikes);
          await sendMessage(chatId, `Результат голосування:\n👍 ${(await env.BOT_KV.get("likes")) || 0} 👎 ${dislikes}`);
        }
      }

      return new Response("OK", { status: 200 });
    }

    return new Response("Hello from Worker!");
  },
};

async function sendMessage(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const body = {
    chat_id: chatId,
    text: text,
    ...extra,
  };
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}