/**
 * Cloudflare Workers — Telegram bot webhook.
 * Env:
 * - BOT_TOKEN (string, required)
 * - WEBHOOK_SECRET (string, required)
 * - API_BASE_URL (string, optional, default "https://api.telegram.org")
 * - STATE (KV Namespace, optional)
 */

/** @typedef {import('@cloudflare/workers-types').KVNamespace} KVNamespace */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** Telegram API helper */
async function tg(env, method, body) {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  return fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** Safe JSON read */
async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

/** Responses */
const ok  = (data = {}) => new Response(JSON.stringify({ ok: true,  ...data }), { headers: JSON_HEADERS });
const err = (message, status = 200) =>
  new Response(JSON.stringify({ ok: false, error: String(message) }), { headers: JSON_HEADERS, status });

/** Main update handler */
async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message || update.callback_query?.message;
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  const text = (update.message?.text || "").trim();
  const kv = env.STATE;

  if (text === "/start") {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "👋 Привіт! Бот на Cloudflare Workers.\nКоманди: /ping, /kvset <key> <value>, /kvget <key>",
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
    if (!kv) { await tg(env, "sendMessage", { chat_id: chatId, text: "❌ KV не прив'язано (STATE)." }); return; }
    if (!key || !value) { await tg(env, "sendMessage", { chat_id: chatId, text: "Використання: /kvset <key> <value>" }); return; }
    await kv.put(key, value);
    await tg(env, "sendMessage", { chat_id: chatId, text: `✅ Збережено: ${key} = ${value}` });
    return;
  }

  if (text.startsWith("/kvget")) {
    const [, key] = text.split(/\s+/);
    if (!kv) { await tg(env, "sendMessage", { chat_id: chatId, text: "❌ KV не прив'язано (STATE)." }); return; }
    if (!key) { await tg(env, "sendMessage", { chat_id: chatId, text: "Використання: /kvget <key>" }); return; }
    const value = await kv.get(key);
    await tg(env, "sendMessage", { chat_id: chatId, text: value != null ? `🗄 ${key} = ${value}` : `😕 Не знайдено ключ: ${key}` });
    return;
  }

  if (msg?.photo || msg?.document) {
    await tg(env, "sendMessage", { chat_id: chatId, text: "📸 Дякую! Отримав файл.", reply_to_message_id: msg.message_id });
    return;
  }

  if (text) {
    await tg(env, "sendMessage", { chat_id: chatId, text: `Ти написав: ${text}`, reply_to_message_id: msg.message_id });
    return;
  }

  await tg(env, "sendMessage", { chat_id: chatId, text: "✅ Отримав оновлення." });
}

/** @typedef {Object} Env
 * @property {string} BOT_TOKEN
 * @property {string} WEBHOOK_SECRET
 * @property {string} [API_BASE_URL]
 * @property {KVNamespace} [STATE]
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const secret = (env.WEBHOOK_SECRET || "").trim();

    // Health
    if (method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
      return ok({ service: "senti-bot-worker", env: "ok" });
    }

    // ---- Webhook matching (два безпечні варіанти) ----
    // 1) /webhook/<secret> у шляху
    const pathMatch = secret && url.pathname === `/webhook/${secret}`;

    // 2) /webhook + заголовок X-Telegram-Bot-Api-Secret-Token === secret
    const headerSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
    const headerMatch = secret && url.pathname === "/webhook" && headerSecret.trim() === secret;

    if (pathMatch || headerMatch) {
      if (method !== "POST") return err("Method must be POST");
      const update = await readJson(request);
      if (!update) return err("Invalid JSON");

      // Безпечно залогувати тільки те, що не палить секрет
      try {
        console.log("Webhook hit", {
          path: url.pathname,
          via: pathMatch ? "path" : "header",
          hasToken: Boolean(env.BOT_TOKEN),
        });
      } catch (_) {}

      // Оброблюємо асинхронно, Telegram одразу отримує 200
      handleUpdate(update, env).catch((e) => console.error("handleUpdate error:", e?.stack || e));
      return ok({ received: true });
    }
    // ---------------------------------------------------

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  },
};