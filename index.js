// Senti Bot Worker — стабільний обробник Telegram + Workers AI
// Без зовнішніх залежностей. Під Wrangler v4 (nodejs_compat).

const CF_ACCOUNT_ID = "2cf6e316af8623546c95c0354bc3aa00";
const TEXT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

// ———————————————————————————————————————————————————————————————————
// HTTP entry
// ———————————————————————————————————————————————————————————————————
export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;

      // Healthcheck
      if (request.method === "GET" && path === "/") {
        return json200({ ok: true, name: "senti-bot-worker", health: "green" });
      }

      // Telegram webhook
      if (request.method === "POST" && path === "/webhook") {
        // Перевірка секретного заголовка
        const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (!secret || secret !== env.WEBHOOK_SECRET) {
          return new Response("Unauthorized", { status: 403 });
        }

        const update = await safeJson(request);
        if (!update) return json200({ ok: true });

        if (update.message) {
          await handleMessage(update.message, env);
          return json200({ ok: true });
        }
        if (update.edited_message) {
          await handleMessage(update.edited_message, env);
          return json200({ ok: true });
        }
        return json200({ ok: true });
      }

      return new Response("Not found", { status: 404 });
    } catch (err) {
      return new Response("Internal error: " + (err?.message || String(err)), { status: 500 });
    }
  },
};

// ———————————————————————————————————————————————————————————————————
// Telegram message handler
// ———————————————————————————————————————————————————————————————————
async function handleMessage(msg, env) {
  const chatId = msg.chat?.id;
  if (!chatId) return;

  // Команди
  const text = msg.text?.trim();
  if (text === "/start" || text === "/help") {
    await sendTelegram(env, "sendMessage", {
      chat_id: chatId,
      text:
        "Привіт! Я Senti 🤖\n" +
        "• Напиши текст — відповім коротко (2–3 речення)\n" +
        "• Надішли фото — опишу зображення\n" +
        "• Команди: /start, /help, /whoami",
    });
    return;
  }
  if (text === "/whoami") {
    const me = await getMe(env);
    await sendTelegram(env, "sendMessage", {
      chat_id: chatId,
      text: `Я: ${me?.result?.username || "невідомо"} (ok: ${me?.ok})`,
    });
    return;
  }

  // Фото → візуальна модель
  if (msg.photo?.length) {
    await sendTelegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const imageUrl = await getFileUrl(env, fileId);
    const prompt = "Опиши це фото українською у 2–3 реченнях.";

    const aiText = await callWorkersAI(env, VISION_MODEL, { prompt, image: imageUrl });
    await sendTelegram(env, "sendMessage", { chat_id: chatId, text: aiText });
    return;
  }

  // Текст → текстова модель
  if (text) {
    await sendTelegram(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    const prompt = `Скажи українською 2–3 речення: ${text}`;
    const aiText = await callWorkersAI(env, TEXT_MODEL, { prompt });
    await sendTelegram(env, "sendMessage", { chat_id: chatId, text: aiText });
    return;
  }
}

// ———————————————————————————————————————————————————————————————————
async function callWorkersAI(env, model, payload) {
  // Стійкий виклик із ретраями на 429/5xx
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`;
  const body = JSON.stringify(payload);

  const headers = {
    Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  // до 3 спроб з експоненційною затримкою
  let delay = 400;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { method: "POST", headers, body });
    const okStatus = r.status >= 200 && r.status < 300;
    const data = await safeJsonResp(r);

    if (okStatus && data?.success && data?.result?.response) {
      return data.result.response;
    }

    // 429/5xx → retry
    if (r.status === 429 || r.status >= 500) {
      await sleep(delay);
      delay *= 2;
      continue;
    }

    // інші помилки — одразу виводимо
    return "⚠️ Помилка AI: " + tryStringify(data ?? { status: r.status });
  }

  return "⚠️ AI тимчасово недоступний. Спробуй ще раз.";
}

// ———————————————————————————————————————————————————————————————————
// Telegram helpers
// ———————————————————————————————————————————————————————————————————
async function sendTelegram(env, method, data) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => {});
}

async function getMe(env) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`;
  const r = await fetch(url);
  return await safeJsonResp(r);
}

async function getFileUrl(env, fileId) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(
    fileId
  )}`;
  const data = await (await fetch(url)).json().catch(() => null);
  if (!data?.ok) return null;
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
}

// ———————————————————————————————————————————————————————————————————
// utils
// ———————————————————————————————————————————————————————————————————
async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
async function safeJsonResp(r) {
  try {
    return await r.json();
  } catch {
    return null;
  }
}
function json200(obj) {
  return new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
}
function tryStringify(x) {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));