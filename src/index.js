/**
 * Cloudflare Workers — Telegram bot webhook (стабільний).
 * Env:
 *  - BOT_TOKEN (required)
 *  - WEBHOOK_SECRET (required)
 *  - API_BASE_URL (optional, default https://api.telegram.org)
 *  - STATE (KV, optional)
 */

/** @typedef {import('@cloudflare/workers-types').KVNamespace} KVNamespace */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

const ok  = (data={}) =>
  new Response(JSON.stringify({ ok: true, ...data }), { headers: JSON_HEADERS });

const err = (message, status = 200) =>
  // 200 щоб Telegram не ретраїв — але у логах помилку видно
  new Response(JSON.stringify({ ok: false, error: String(message) }), {
    headers: JSON_HEADERS, status
  });

/** @typedef {{BOT_TOKEN:string, WEBHOOK_SECRET:string, API_BASE_URL?:string, STATE?:KVNamespace}} Env */

function apiBase(env) {
  return (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
}

/**
 * Виклик Telegram Bot API
 * @param {Env} env
 * @param {string} method
 * @param {any} body
 */
async function tg(env, method, body) {
  const token = env.BOT_TOKEN;
  if (!token) {
    console.error("BOT_TOKEN is missing");
    return new Response(null, { status: 500 });
  }
  const url = `${apiBase(env)}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    console.error("TG API error:", method, res.status, text);
  }
  return res;
}

/** Безпечно читаємо JSON */
async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

/** Основна логіка обробки апдейта */
async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message || update.callback_query?.message;
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  const text = (update.message?.text || "").trim();
  const kv = env.STATE;

  if (text === "/start") {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text:
        "👋 Привіт! Бот підключено до Cloudflare Workers.\n" +
        "Спробуй: /ping, просто напиши текст, або /kvset <key> <value>, /kvget <key>",
    });
    return;
  }

  if (text === "/ping") {
    await tg(env, "sendMessage", { chat_id: chatId, text: "pong ✅" });
    return;
  }

  if (text.startsWith("/kvset")) {
    const [, key, ...rest] = text.split(/\s+/);
    const value = rest.join(" ");
    if (!kv) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "❌ KV не прив'язано (STATE)." });
      return;
    }
    if (!key || !value) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "Використання: /kvset <key> <value>" });
      return;
    }
    await kv.put(key, value);
    await tg(env, "sendMessage", { chat_id: chatId, text: `✅ Збережено: ${key} = ${value}` });
    return;
  }

  if (text.startsWith("/kvget")) {
    const [, key] = text.split(/\s+/);
    if (!kv) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "❌ KV не прив'язано (STATE)." });
      return;
    }
    if (!key) {
      await tg(env, "sendMessage", { chat_id: chatId, text: "Використання: /kvget <key>" });
      return;
    }
    const value = await kv.get(key);
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: value != null ? `🗄 ${key} = ${value}` : `😕 Не знайдено ключ: ${key}`,
    });
    return;
  }

  if (msg?.photo || msg?.document) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "📸 Дякую! Отримав файл.",
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  if (text) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: `Ти написав: ${text}`,
      reply_to_message_id: msg.message_id,
    });
  }
}

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
      return ok({ service: "senti-bot-worker", env: "ok" });
    }

    // Webhook
    if (url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      if (request.method !== "POST") return err("Method must be POST");
      const update = await readJson(request);
      if (!update) return err("Invalid JSON");

      // Надійно: не обривати обробку
      ctx.waitUntil(handleUpdate(update, env));
      // Або замість waitUntil можна було б: await handleUpdate(update, env);

      return ok({ received: true });
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  },
};