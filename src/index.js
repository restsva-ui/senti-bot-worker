/**
 * Cloudflare Workers — Telegram bot webhook.
 * Env vars (set in Wrangler / Dashboard):
 * - BOT_TOKEN         (string, required)
 * - WEBHOOK_SECRET    (string, required)
 * - API_BASE_URL      (string, optional, default "https://api.telegram.org")
 * - STATE             (KV Namespace, optional)
 */

/** @typedef {import('@cloudflare/workers-types').KVNamespace} KVNamespace */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/**
 * Send a request to Telegram Bot API
 * @param {Env} env
 * @param {string} method e.g. "sendMessage"
 * @param {any} body
 */
async function tg(env, method, body) {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  return fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/**
 * Safely parse request JSON
 * @param {Request} req
 */
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/**
 * Small helpers
 */
const ok = (data = {}) => new Response(JSON.stringify({ ok: true, ...data }), { headers: JSON_HEADERS });
const err = (message, status = 200) =>
  // 200: щоб Telegram не ретраїв. У логах буде видно помилку.
  new Response(JSON.stringify({ ok: false, error: String(message) }), {
    headers: JSON_HEADERS,
    status,
  });

/**
 * Handle Telegram update
 * @param {any} update
 * @param {Env} env
 */
async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message || update.callback_query?.message;
  const chatId = msg?.chat?.id;

  // No chat — nothing to do
  if (!chatId) return;

  // Text commands
  const text = (update.message?.text || "").trim();

  // KV helpers (optional, if STATE is bound)
  const kv = env.STATE;

  if (text === "/start") {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "👋 Привіт! Бот підключено до Cloudflare Workers.\nСпробуй: /ping, просто напиши текст, або /kvset ключ значення, /kvget ключ",
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

  // Photo / Document acknowledgment
  if (msg?.photo || msg?.document) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "📸 Дякую! Отримав файл.",
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  // Echo for any other text
  if (text) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: `Ти написав: ${text}`,
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  // Fallback: acknowledge update
  await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Отримав оновлення." });
}

/**
 * @typedef {Object} Env
 * @property {string} BOT_TOKEN
 * @property {string} WEBHOOK_SECRET
 * @property {string} [API_BASE_URL]
 * @property {KVNamespace} [STATE]
 */

export default {
  /**
   * @param {Request} request
   * @param {Env} env
   */
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
      return ok({ service: "senti-bot-worker", env: "ok" });
    }

    // Webhook endpoint: /webhook/<WEBHOOK_SECRET>
    if (url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      if (request.method !== "POST") return err("Method must be POST");
      const update = await readJson(request);
      if (!update) return err("Invalid JSON");

      // Handle in background; відповідаємо Telegram миттєво
      // щоб не ловити таймаути та 404
      // (Cloudflare дозволяє fire-and-forget без await)
      handleUpdate(update, env).catch((e) =>
        console.error("handleUpdate error:", e?.stack || e)
      );

      return ok({ received: true });
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  },
};