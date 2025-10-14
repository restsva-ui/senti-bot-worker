// Telegram webhook handler (safe + logging) + reply-keyboards

import { sendMessage } from "../lib/telegram.js";
import { abs } from "../utils/url.js";

function defaultKeyboard() {
  return {
    keyboard: [
      [{ text: "Гугл драйв" }, { text: "Senti" }],
      [{ text: "Admin" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function adminKeyboard() {
  return {
    keyboard: [
      [{ text: "чеклист" }, { text: "поставити вебхук" }],
      [{ text: "запустити нічного агента" }],
      [{ text: "← Назад" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function isAdmin(env, from) {
  const adminId = String(env.TELEGRAM_ADMIN_ID || "").trim();
  return adminId && String(from?.id || "") === adminId;
}

export async function handleTelegramWebhook(request, env, url) {
  // GET check
  if (request.method === "GET") {
    return new Response(JSON.stringify({ ok: true, method: "GET", message: "webhook alive" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = await request.json();

    // --- Secret header check (accept several env names) ---
    const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
    const secretOk =
      secretHeader === env.TG_WEBHOOK_SECRET ||
      secretHeader === env.WEBHOOK_SECRET ||
      secretHeader === env.TELEGRAM_SECRET_TOKEN;

    // Return 200 on unauthorized so Telegram doesn't drop webhook;
    // but mark response as unauthorized.
    if (!secretOk) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 200 });
    }

    const message = body.message || body.edited_message || body.channel_post || null;
    if (!message || !message.chat) {
      return new Response(JSON.stringify({ ok: true, skip: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const chatId = message.chat.id;
    const from = message.from || {};
    const text = (message.text || "").trim();

    // --- ROUTER ---

    // /start → вітання + дефолтні кнопки
    if (text === "/start") {
      await sendMessage(env, chatId, "Привіт! Я на зв’язку 👋", {
        reply_markup: defaultKeyboard(),
      });
      // log for you
      if (env.TELEGRAM_ADMIN_ID) {
        await sendMessage(env, env.TELEGRAM_ADMIN_ID, `[direct] handled /start`);
      }
      return ok();
    }

    // Кнопка "Гугл драйв" → посилання на OAuth
    if (/^гугл\s*драйв$/i.test(text)) {
      const authUrl = new URL(abs(env, "/auth/start"));
      authUrl.searchParams.set("u", String(chatId));
      await sendMessage(
        env,
        chatId,
        `Щоб під’єднати Google Drive, відкрий посилання:\n${authUrl.toString()}`,
        { reply_markup: defaultKeyboard() }
      );
      return ok();
    }

    // Кнопка "Senti"
    if (/^senti$/i.test(text)) {
      await sendMessage(env, chatId, "Senti тут. Чим допомогти? 🙂", {
        reply_markup: defaultKeyboard(),
      });
      return ok();
    }

    // Кнопка "Admin"
    if (/^admin$/i.test(text)) {
      if (!isAdmin(env, from)) {
        await sendMessage(env, chatId, "⛔️ Доступ лише для адміністратора.", {
          reply_markup: defaultKeyboard(),
        });
        return ok();
      }
      await sendMessage(env, chatId, "Адмін-панель:", {
        reply_markup: adminKeyboard(),
      });
      return ok();
    }

    // Адмін: "← Назад"
    if (/^←\s*назад$/i.test(text)) {
      await sendMessage(env, chatId, "Повертаюсь до головного меню.", {
        reply_markup: defaultKeyboard(),
      });
      return ok();
    }

    // Адмін: "чеклист" → лінк на UI
    if (/^чеклист$/i.test(text) && isAdmin(env, from)) {
      const link = abs(env, "/admin/checklist/with-energy");
      await sendMessage(env, chatId, `Відкрити чеклист:\n${link}`, {
        reply_markup: adminKeyboard(),
      });
      return ok();
    }

    // Адмін: "поставити вебхук" → виклик /tg/set-webhook
    if (/^поставити\s+вебхук$/i.test(text) && isAdmin(env, from)) {
      const setUrl = abs(env, "/tg/set-webhook");
      const r = await fetch(setUrl);
      let msg = "Вебхук оновлено.";
      try {
        const d = await r.text();
        msg = d?.length < 200 ? d : "Webhook set (response too long)";
      } catch {}
      await sendMessage(env, chatId, msg, { reply_markup: adminKeyboard() });
      return ok();
    }

    // Адмін: "запустити нічного агента" → /cron/auto-improve?s=<secret>
    if (/^запустити\s+нічного\s+агента$/i.test(text) && isAdmin(env, from)) {
      let runUrl = new URL(abs(env, "/cron/auto-improve"));
      if (env.WEBHOOK_SECRET) runUrl.searchParams.set("s", env.WEBHOOK_SECRET);
      const r = await fetch(runUrl.toString());
      let msg = "Нічного агента запущено.";
      try {
        const d = await r.json();
        msg = `Auto-improve: ${d?.ok ? "OK" : "FAIL"}`
          + (d?.insights ? `, insights: ${d.insights.length}` : "");
      } catch {}
      await sendMessage(env, chatId, msg, { reply_markup: adminKeyboard() });
      return ok();
    }

    // Пінг
    if (text.toLowerCase().includes("ping")) {
      await sendMessage(env, chatId, "pong ✅", { reply_markup: defaultKeyboard() });
      return ok();
    }

    // Інше — просто ехо + клавіатура
    await sendMessage(env, chatId, `Ти написав: ${text}`, {
      reply_markup: defaultKeyboard(),
    });

    // Тихий лог у приват адміна
    if (env.TELEGRAM_ADMIN_ID) {
      await sendMessage(env, env.TELEGRAM_ADMIN_ID, `[update] ${chatId}: ${text}`);
    }

    return ok();

    function ok() {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    // тихе повідомлення адміна і завжди 200
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