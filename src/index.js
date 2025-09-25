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
  return fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

const ok  = (data = {}) => new Response(JSON.stringify({ ok: true, ...data }), { headers: JSON_HEADERS });
const err = (message, status = 200) =>
  new Response(JSON.stringify({ ok: false, error: String(message) }), { headers: JSON_HEADERS, status });

/**
 * Базова (вже працююча) логіка бота: /start, /ping, /kvset, /kvget, echo
 */
async function handleBasic(update, env) {
  // ⚠️ Не обробляти callback_query тут — вони йдуть у router.js
  if (update.callback_query) return;

  const msg = update.message || update.edited_message;
  const chatId = msg?.chat?.id;
  if (!chatId) return;

  const text = (update.message?.text || "").trim();
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

  // Фото/документи — підтвердження
  if (msg?.photo || msg?.document) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "📸 Дякую! Отримав файл.",
      reply_to_message_id: msg.message_id,
    });
    return;
  }

  // Ехо для будь-якого іншого тексту
  if (text) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: `Ти написав: ${text}`,
      reply_to_message_id: msg.message_id,
    });
    return;
  }
}

export default {
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

      // 1) делегуємо нові кнопки/команди у роутер (fire-and-forget)
      routeUpdate(env, update).catch((e) =>
        console.error("routeUpdate error:", e?.stack || e)
      );

      // 2) базова логіка (без callback_query)
      handleBasic(update, env).catch((e) =>
        console.error("handleBasic error:", e?.stack || e)
      );

      // Відповідаємо Telegram миттєво
      return ok({ received: true });
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  },
};