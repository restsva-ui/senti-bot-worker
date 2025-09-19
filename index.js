// Senti Bot Worker — Cloudflare Workers v4 (nodejs_compat)
// Підтримка: healthcheck, Telegram webhook із секретом, текст/фото, виклик Workers AI, ретраї.

const CF_ACCOUNT_ID = "2cf6e316af8623546c95c0354bc3aa00";
const TEXT_MODEL   = "@cf/meta/llama-3.1-8b-instruct";
const VISION_MODEL = "@cf/llava-hf/llava-1.5-7b-hf";

export default {
  async fetch(request, env, ctx) {
    try {
      const { pathname } = new URL(request.url);

      // Healthcheck
      if (request.method === "GET" && pathname === "/") {
        return json({ ok: true, service: "senti-bot-worker", health: "green" });
      }

      // Telegram webhook
      if (request.method === "POST" && pathname === "/webhook") {
        const header = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (header !== env.WEBHOOK_SECRET) {
          return new Response("Forbidden", { status: 403 });
        }
        const update = await safeJsonBody(request);
        if (!update) return json({ ok: true });

        if (update.message) {
          ctx.waitUntil(handleMessage(update.message, env));
          return json({ ok: true });
        }
        if (update.edited_message) {
          ctx.waitUntil(handleMessage(update.edited_message, env));
          return json({ ok: true });
        }
        return json({ ok: true });
      }

      return new Response("Not Found", { status: 404 });
    } catch (e) {
      return new Response("Internal error: " + (e?.message || String(e)), { status: 500 });
    }
  },
};

// ---------------------------- Telegram logic ----------------------------

async function handleMessage(msg, env) {
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  const text = (msg.text || "").trim();

  // Команди
  if (text === "/start" || text === "/help") {
    await tg(env, "sendMessage", {
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
    const me = await tg(env, "getMe");
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: me?.ok ? `Я: @${me.result?.username || "unknown"}` : "Не зміг отримати getMe",
    });
    return;
  }

  // Фото → опис
  if (msg.photo?.length) {
    await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const imageUrl = await getFileUrl(env, fileId);
    const prompt = "Опиши це фото українською у 2–3 реченнях.";
    const answer = await callWorkersAI(env, VISION_MODEL, { prompt, image: imageUrl });
    await tg(env, "sendMessage", { chat_id: chatId, text: answer });
    return;
  }

  // Текст → відповідь
  if (text) {
    await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" });
    const prompt = `Скажи українською 2–3 речення: ${text}`;
    const answer = await callWorkersAI(env, TEXT_MODEL, { prompt });
    await tg(env, "sendMessage", { chat_id: chatId, text: answer });
  }
}

// ---------------------------- Workers AI ----------------------------

async function callWorkersAI(env, model, payload) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${model}`;
  const headers = {
    Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify(payload);

  // 3 ретраї на 429/5xx
  let wait = 400;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers, body });
      const data = await safeJsonResp(r);

      if (r.ok && data?.success && data?.result?.response) return data.result.response;

      if (r.status === 429 || r.status >= 500) {
        await sleep(wait);
        wait *= 2;
        continue;
      }
      return "⚠️ Помилка AI: " + tryStringify(data ?? { status: r.status });
    } catch (e) {
      await sleep(wait);
      wait *= 2;
    }
  }
  return "⚠️ AI тимчасово недоступний. Спробуй ще раз.";
}

// ---------------------------- Telegram API helpers ----------------------------

async function tg(env, method, payload) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
  const opts = payload
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    : { method: "GET" };
  const r = await fetch(url, opts).catch(() => null);
  return r ? await safeJsonResp(r) : null;
}

async function getFileUrl(env, fileId) {
  const info = await tg(env, `getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!info?.ok) return null;
  return `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`;
}

// ---------------------------- utils ----------------------------

function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function safeJsonBody(req) {
  try {
    return await req.json();
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
function tryStringify(x) {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));