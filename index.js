export default {
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);

      // Healthcheck
      if (request.method === "GET" && pathname === "/") {
        return new Response("Senti worker up ✅", { status: 200 });
      }

      // Telegram webhook
      if (request.method === "POST" && pathname === "/webhook") {
        const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (secret !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 403 });
        }
        const update = await request.json();
        if (update.message) {
          await handleMessage(update.message, env);
        }
        return new Response("ok", { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Internal error: " + (err && err.message ? err.message : String(err)), { status: 500 });
    }
  },
};

async function handleMessage(msg, env) {
  const chatId = msg.chat.id;

  // Текст
  if (msg.text) {
    const prompt = `Скажи українською 2–3 речення: ${msg.text}`;
    const reply = await runAI(env, { prompt });
    await sendTelegram(env, chatId, reply);
  }

  // Фото
  if (msg.photo && msg.photo.length) {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const imgUrl = await getFileUrl(env, fileId);
    const prompt = "Опиши це фото українською у 2–3 реченнях.";
    const reply = await runAI(env, { prompt, image: imgUrl });
    await sendTelegram(env, chatId, reply);
  }
}

async function runAI(env, { prompt, image }) {
  // Виклик Workers AI через REST (працює з нашим токеном)
  const accountId = "2cf6e316af8623546c95c0354bc3aa00";
  const model = image ? "@cf/llava-hf/llava-1.5-7b-hf" : "@cf/meta/llama-3.1-8b-instruct";
  const body = image ? { prompt, image } : { prompt };

  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => ({}));
  if (data && data.success && data.result && data.result.response) return data.result.response;
  return "⚠️ Помилка AI: " + JSON.stringify(data);
}

async function sendTelegram(env, chatId, text) {
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function getFileUrl(env, fileId) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
  const j = await r.json();
  if (!j.ok) return null;
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${j.result.file_path}`;
}