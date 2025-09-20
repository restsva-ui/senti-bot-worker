// index.js — Cloudflare Worker (stable)

const ROUTES = {
  HEALTH: "/health",
  DEBUG: "/debug",
  WEBHOOK: "/webhook",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // простий healthcheck
    if (url.pathname === ROUTES.HEALTH) {
      return new Response("ok", { status: 200 });
    }

    // віддати останній лог апдейта (для ручної діагностики з мобільного)
    if (url.pathname === ROUTES.DEBUG) {
      return new Response(JSON.stringify({ lastUpdate: env.__LAST_UPDATE || null }, null, 2), {
        status: 200,
        headers: { "content-type": "application/json; charset=UTF-8" },
      });
    }

    // тільки POST на /webhook
    if (url.pathname !== ROUTES.WEBHOOK || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    try {
      // 1) Валідація секрету з хедера
      const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      const expected = env.WEBHOOK_SECRET || "";
      if (!expected || got !== expected) {
        return new Response("Forbidden", { status: 403 });
      }

      // 2) Розбір апдейта
      const update = await request.json().catch(() => ({}));
      // збережемо короткий лог у пам’яті воркера для /debug
      env.__LAST_UPDATE = {
        at: new Date().toISOString(),
        preview: JSON.stringify(update).slice(0, 500),
      };

      // апдейти можуть бути різні (message, edited_message, callback_query тощо)
      const msg = update?.message;
      const chatId = msg?.chat?.id;
      const text = (msg?.text || "").trim();

      // Якщо немає, завершимося "тихо", але з 200 (щоб TG не ретраїв)
      if (!chatId || !text) {
        return new Response("no-op", { status: 200 });
      }

      // 3) Роутінг команд
      if (text === "/start") {
        await reply(env, chatId, [
          "Привіт! Я Senti 🤖",
          "Надішли будь-який текст — я повторю його у відповідь.",
          "Команди: /start, /ping",
        ].join("\n"));
      } else if (text === "/ping") {
        await reply(env, chatId, "pong ✅");
      } else {
        await reply(env, chatId, `echo: ${text}`);
      }

      return new Response("ok", { status: 200 });
    } catch (e) {
      // ховаємо стек у відповідь, але логічно відповідаємо 200
      // (щоб TG не DDoS ретраями), а причину запишемо у "внутрішній" лог
      env.__LAST_UPDATE = {
        at: new Date().toISOString(),
        error: String(e?.stack || e),
      };
      return new Response("ok", { status: 200 });
    }
  },
};

// ————— helpers —————
async function reply(env, chatId, text) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("No TELEGRAM_BOT_TOKEN in env");

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = { chat_id: chatId, text };

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  // якщо Telegram повернув не 200 — піднімаємо помилку (вона піде у __LAST_UPDATE)
  if (!r.ok) {
    const t = await safeText(r);
    throw new Error(`sendMessage failed: ${r.status} ${r.statusText} :: ${t}`);
  }
}

async function safeText(r) {
  try { return await r.text(); } catch { return "<no body>"; }
}