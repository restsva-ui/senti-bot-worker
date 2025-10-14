// src/routes/webhook.js
// Telegram webhook handler (safe + logging)

import { sendMessage } from "../lib/telegram.js";

export async function handleTelegramWebhook(request, env) {
  if (request.method === "GET") {
    return new Response(JSON.stringify({ ok: true, method: "GET", message: "webhook alive" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();
    const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
    const secretOk =
      secretHeader === env.TG_WEBHOOK_SECRET ||
      secretHeader === env.WEBHOOK_SECRET ||
      secretHeader === env.TELEGRAM_SECRET_TOKEN;

    if (!secretOk) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 200 });
    }

    const message = body.message || body.edited_message;
    if (!message || !message.chat) {
      return new Response(JSON.stringify({ ok: true, skip: true }));
    }

    const chatId = message.chat.id;
    const text = message.text || "";

    // --- Basic router ---
    if (text === "/start") {
      await sendMessage(env, chatId, "👋 Привіт! Я Senti — бот-асистент.\nНапиши 'ping' для тесту.");
    } else if (text.toLowerCase().includes("ping")) {
      await sendMessage(env, chatId, "pong ✅");
    } else {
      await sendMessage(env, chatId, `Ти написав: ${text}`);
    }

    // log in checklist
    if (env.TELEGRAM_ADMIN_ID) {
      await sendMessage(env, env.TELEGRAM_ADMIN_ID, `[update] ${chatId}: ${text}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    try {
      if (env.TELEGRAM_ADMIN_ID) {
        await sendMessage(env, env.TELEGRAM_ADMIN_ID, `[webhook error] ${String(e?.message || e)}`);
      }
    } catch {}
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}