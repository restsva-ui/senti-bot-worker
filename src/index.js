/**
 * Cloudflare Workers — Telegram bot webhook (з роутером кнопок/команд).
 * Env:
 *  BOT_TOKEN (string)
 *  WEBHOOK_SECRET (string)
 *  API_BASE_URL (optional, default https://api.telegram.org)
 *  STATE (KV Namespace, optional)
 */

import { routeUpdate } from "./router.js";

/** @typedef {import('@cloudflare/workers-types').KVNamespace} KVNamespace */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

async function tg(env, method, body) {
  const base = (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`TG ${method} HTTP ${res.status}`);
    }
    return res;
  } catch (e) {
    console.error(`TG ${method} fetch error:`, e?.stack || e);
    throw e;
  }
}

async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

const ok  = (data = {}) => new Response(JSON.stringify({ ok: true, ...data }), { headers: JSON_HEADERS });
const err = (message, status = 200) =>
  new Response(JSON.stringify({ ok: false, error: String(message) }), { headers: JSON_HEADERS, status });

/**
 * Базова логіка бота: /start, /ping, /kvset, /kvget, echo
 * (callback_query тут НЕ обробляємо — це робить router.js)
 */
async function handleBasic(update, env) {
  try {
    if (update.callback_query) return;

    const msg = update.message || update.edited_message;
    const chatId = msg?.chat?.id;
    if (!chatId) {
      console.log("handleBasic: no chatId");
      return;
    }

    const text = (update.message?.text || "").trim();
    const kv = env.STATE;

    if (text === "/start") {
      console.log("handleBasic: /start");
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: "👋 Привіт! Бот підключено до Cloudflare Workers.\nСпробуй: /ping, просто напиши текст, або /kvset ключ значення, /kvget ключ",
      });
      return;
    }

    if (text === "/ping") {
      console.log("handleBasic: /ping");
      await tg(env, "sendMessage", { chat_id: chatId, text: "pong ✅" });
      return;
    }

    if (text.startsWith("/kvset")) {
      console.log("handleBasic: /kvset");
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
      console.log("handleBasic: /kvget");
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
      console.log("handleBasic: file/photo");
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: "📸 Дякую! Отримав файл.",
        reply_to_message_id: msg.message_id,
      });
      return;
    }

    if (text) {
      console.log("handleBasic: echo");
      await tg(env, "sendMessage", {
        chat_id: chatId,
        text: `Ти написав: ${text}`,
        reply_to_message_id: msg.message_id,
      });
      return;
    }
  } catch (e) {
    console.error("handleBasic error:", e?.stack || e);
  }
}

export default {
  /**
   * ВАЖЛИВО: використовуємо ctx.waitUntil(...) щоб фонові задачі (відповіді в TG)
   * гарантовано виконались навіть після миттєвої 200-відповіді Telegram'у.
   */
  async fetch(request, env, ctx) {
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

      try { console.log("🔔 Update:", JSON.stringify(update)); } catch {}

      const p1 = routeUpdate(env, update).catch((e) =>
        console.error("routeUpdate error:", e?.stack || e)
      );
      const p2 = handleBasic(update, env).catch((e) =>
        console.error("handleBasic error (outer):", e?.stack || e)
      );

      // не даємо згорнутись фоновим обіцянкам
      ctx.waitUntil(Promise.allSettled([p1, p2]));

      return ok({ received: true });
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  },
};