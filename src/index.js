/**
 * Cloudflare Workers — Telegram bot webhook.
 * Env:
 *  - BOT_TOKEN (secret, required)
 *  - WEBHOOK_SECRET (string, required)  // зараз: "senti1984"
 *  - API_BASE_URL (optional, default https://api.telegram.org)
 *  - STATE (KV, optional)
 */

/** @typedef {import('@cloudflare/workers-types').KVNamespace} KVNamespace */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

async function tg(env, method, body) {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  // Логи на випадок помилок Telegram API (401, 400 тощо)
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Telegram API error:", res.status, text);
  }
  return res;
}

async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

const ok = (data = {}) =>
  new Response(JSON.stringify({ ok: true, ...data }), { headers: JSON_HEADERS });

const err = (message, status = 200) =>
  new Response(JSON.stringify({ ok: false, error: String(message) }), {
    headers: JSON_HEADERS,
    status,
  });

async function handleUpdate(update, env) {
  try {
    console.log("Update:", JSON.stringify(update)); // для діагностики

    const msg = update.message || update.edited_message || update.callback_query?.message;
    const chatId = msg?.chat?.id;
    const text = (update.message?.text || "").trim();
    const kv = env.STATE;

    if (!chatId) return;

    if (text === "/start") {
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text:
          "👋 Привіт! Бот підключено до Cloudflare Workers.\n" +
          "Команди: /ping, /kvset <key> <value>, /kvget <key>",
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
      return;
    }
  } catch (e) {
    console.error("handleUpdate error:", e?.stack || e);
  }
}

/** @typedef {{ BOT_TOKEN:string; WEBHOOK_SECRET:string; API_BASE_URL?:string; STATE?:KVNamespace }} Env */
export default {
  /** @param {Request} request @param {Env} env @param {ExecutionContext} ctx */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
      return ok({ service: "senti-bot-worker", env: "ok" });
    }

    // ВАЖЛИВО: суворий збіг шляху з секретом
    if (url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      if (request.method !== "POST") return err("Method must be POST");
      const update = await readJson(request);
      if (!update) return err("Invalid JSON");

      // Правильний спосіб запускати асинхронну обробку після відповіді:
      ctx.waitUntil(handleUpdate(update, env));

      // Миттєво відповідаємо Telegram 200 OK
      return ok({ received: true });
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  },
};