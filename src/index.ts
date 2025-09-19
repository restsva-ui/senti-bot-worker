export default {
  async fetch(request, env) {
    try {
      // Telegram webhook
      if (request.method === "POST" && new URL(request.url).pathname === "/webhook") {
        const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (secret !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 403 });
        }

        const update = await request.json();
        if (update.message) {
          return await handleMessage(update.message, env);
        }

        return new Response("ok");
      }

      // Healthcheck
      if (request.method === "GET" && new URL(request.url).pathname === "/") {
        return new Response("Senti worker up ✅", { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Internal error: " + err.message, { status: 500 });
    }
  },
};

async function handleMessage(msg, env) {
  const chatId = msg.chat.id;

  if (msg.text) {
    // Якщо користувач відправив текст
    const prompt = `Скажи українською 2-3 речення: ${msg.text}`;
    const aiResponse = await callWorkersAI(env, prompt);

    await sendTelegram(env, chatId, aiResponse);
  }

  if (msg.photo) {
    // Якщо користувач відправив фото
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const file = await getFileUrl(env, fileId);
    const prompt = "Опиши це фото українською у 2-3 реченнях.";
    const aiResponse = await callWorkersAI(env, prompt, file);

    await sendTelegram(env, chatId, aiResponse);
  }

  return new Response("ok");
}

async function callWorkersAI(env, prompt, imageUrl = null) {
  const accountId = "2cf6e316af8623546c95c0354bc3aa00";
  const model = imageUrl
    ? "@cf/llava-hf/llava-1.5-7b-hf"
    : "@cf/meta/llama-3.1-8b-instruct";

  const body = imageUrl
    ? { prompt, image: imageUrl }
    : { prompt };

  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const data = await resp.json();
  if (data.success && data.result?.response) {
    return data.result.response;
  } else {
    return "⚠️ Помилка AI: " + JSON.stringify(data.errors || data);
  }
}

async function sendTelegram(env, chatId, text) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
    }),
  });
}

async function getFileUrl(env, fileId) {
  const resp = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  const data = await resp.json();
  if (!data.ok) return null;
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}