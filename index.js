// index.js — стабільний мінімальний воркер для Telegram + health-check
// Використовує змінні середовища:
//   TELEGRAM_BOT_TOKEN  – токен бота
//   WEBHOOK_SECRET      – секрет для X-Telegram-Bot-Api-Secret-Token

const JSON_HEADERS = { "Content-Type": "application/json; charset=UTF-8" };

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // ---- 1) Health-check ---------------------------------------------------
      if (url.pathname === "/health") {
        return json({ ok: true, status: "alive", time: new Date().toISOString() });
      }

      // ---- 2) Проста домашня сторінка ---------------------------------------
      if (url.pathname === "/" && request.method === "GET") {
        return new Response(
          "Senti Bot Worker is running. POST /webhook with valid Telegram secret.",
          { status: 200, headers: { "Content-Type": "text/plain; charset=UTF-8" } }
        );
      }

      // ---- 3) Telegram webhook ----------------------------------------------
      if (url.pathname === "/webhook" && request.method === "POST") {
        // Перевірка секрета від Telegram
        const incomingSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
        if (!incomingSecret || incomingSecret !== env.WEBHOOK_SECRET) {
          return new Response("Forbidden", { status: 403 });
        }

        const update = await safeJson(request);
        // Лог в tail (не впливає на відповідь Telegram)
        ctx.waitUntil(logUpdate(update));

        // Обробка лише текстових повідомлень
        const msg = update?.message;
        const chatId = msg?.chat?.id;
        const text = msg?.text ?? "";

        if (!chatId) {
          // Нічого відповідати не потрібно, просто 200
          return new Response("ok", { status: 200 });
        }

        // Команди
        if (text === "/start") {
          await sendMessage(env, chatId, "Бот Senti запущений ✅\nНапишіть мені щось, відповім дзеркально.");
          return new Response("ok", { status: 200 });
        }

        // Ехо-відповідь
        await sendMessage(env, chatId, `Ти написав: ${text}`);
        return new Response("ok", { status: 200 });
      }

      // ---- 4) Неіснуючі маршрути --------------------------------------------
      return new Response("Not found", { status: 404 });
    } catch (err) {
      // Безпечний fallback, щоб Telegram не ретраїв безкінченно
      console.error("Worker error:", err);
      return json({ ok: false, error: String(err) }, 200);
    }
  },
};

// ========================= Допоміжні функції =================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function logUpdate(update) {
  try {
    console.log("TG update:", JSON.stringify(update));
  } catch {
    // ignore
  }
}

async function sendMessage(env, chatId, text, extra = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is missing");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = { chat_id: chatId, text, ...extra };

  const res = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });

  // Не валимо воркер, але логнемо помилки Telegram
  if (!res.ok) {
    const t = await safeRead(res);
    console.error("sendMessage failed:", res.status, t);
  }
}

async function safeRead(res) {
  try {
    return await res.text();
  } catch {
    return "<no-body>";
  }
}
```0