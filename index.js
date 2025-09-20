// index.js — Senti Bot Worker (stable)

export default {
  async fetch(request, env, ctx) {
    const { TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET } = env;

    // --- маленькі утиліти ---
    const json = (obj, init = {}) =>
      new Response(JSON.stringify(obj), {
        headers: { "content-type": "application/json; charset=utf-8" },
        ...init,
      });
    const text = (t, init = {}) =>
      new Response(t, { headers: { "content-type": "text/plain; charset=utf-8" }, ...init });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/,"") || "/";

    // Глобальний ін-меморі «стан» для /debug (на воркері може жити недовго)
    // якщо потрібна персистентність — підключи KV/DO/Queues з Bindings.
    env.__LAST_UPDATE__ ||= null;

    // --- технічні ендпоїнти ---
    if (path === "/health") {
      return text("ok"); // 200
    }
    if (path === "/debug") {
      return json({ lastUpdate: env.__LAST_UPDATE__ });
    }
    if (path === "/") {
      return text("Senti bot worker: alive");
    }

    // --- основний вебхук ---
    if (path === "/webhook") {
      if (request.method !== "POST") {
        return json({ ok: false, error: "method_not_allowed" }, { status: 405 });
      }

      // Перевірка секрету з Telegram (має 1:1 співпадати з WEBHOOK_SECRET)
      const gotSecret = request.headers.get("x-telegram-bot-api-secret-token");
      if (!WEBHOOK_SECRET || !gotSecret || gotSecret !== WEBHOOK_SECRET) {
        // 403 обовʼязково, щоб Telegram одразу показав помилку у getWebhookInfo
        return json({ ok: false, error: "forbidden" }, { status: 403 });
      }

      // Безпечний парсинг тіла
      let update;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: "bad_json" }, { status: 400 });
      }

      // Збережемо щось у «стан» для /debug
      try {
        const u = update || {};
        env.__LAST_UPDATE__ = {
          id: u.update_id ?? null,
          type: u.message?.text ? "message" : Object.keys(u)[1] || "unknown",
          at: new Date().toISOString(),
        };
      } catch { /* ignore */ }

      // Обробка апдейту
      const tasks = handleUpdate(update, TELEGRAM_BOT_TOKEN);

      // Відповідаємо Telegram миттєво, штовхаємо роботу у фон
      if (tasks && tasks.then) {
        ctx.waitUntil(tasks);
      }
      return json({ ok: true });
    }

    // fallback
    return json({ ok: false, error: "not_found" }, { status: 404 });
  },
};

// ----------------- Бізнес-логіка -----------------

async function handleUpdate(update, BOT_TOKEN) {
  if (!BOT_TOKEN) return;

  const msg = update?.message;
  const chatId = msg?.chat?.id;
  const text = msg?.text?.trim();

  if (!chatId || typeof text !== "string") {
    // Нема що відповідати (наприклад, callback_query/edited_message) — нічого страшного
    return;
  }

  // Прості команди
  if (text === "/start") {
    const body =
      "Привіт! Я Senti 🤖\n" +
      "Надішли будь-який текст — я повторю його у відповідь.\n" +
      "Команди: /start, /ping";
    return tgSendMessage(BOT_TOKEN, chatId, body);
  }

  if (text === "/ping") {
    return tgSendMessage(BOT_TOKEN, chatId, "pong ✅");
  }

  // Ехо за замовчуванням
  return tgSendMessage(BOT_TOKEN, chatId, `echo: ${text}`);
}

// Надсилання повідомлення у Telegram з ретраями/бекофом
async function tgSendMessage(BOT_TOKEN, chatId, text) {
  const api = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = { chat_id: chatId, text };

  let attempt = 0;
  const maxAttempts = 4;

  while (true) {
    attempt++;
    const res = await fetch(api, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    // Успіх
    if (res.ok) {
      return;
    }

    // Обробка 429/5xx з експоненційним бекофом
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= maxAttempts) return;
      const retryAfter =
        Number(res.headers.get("retry-after")) || Math.min(2 ** attempt, 10);
      await sleep((retryAfter + Math.random()) * 1000); // трохи джитера
      continue;
    }

    // На 4xx (крім 429) немає сенсу повторювати
    return;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));