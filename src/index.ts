export interface Env {
  BOT_TOKEN: string;        // wrangler secret put BOT_TOKEN
  WEBHOOK_SECRET?: string;  // wrangler secret put WEBHOOK_SECRET (за замовчуванням 'senti1984')
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const TEXT_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // ---------- Health ----------
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200, headers: TEXT_HEADERS });
    }
    if (url.pathname === "/health.json") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: JSON_HEADERS });
    }
    // ---------- /Health end ----------

    // ---------- Telegram webhook ----------
    const secret = (env.WEBHOOK_SECRET || "senti1984").replace(/^\//, "");
    if (url.pathname === `/webhook/${secret}` && method === "POST") {
      let update: any = null;

      try {
        // Telegram надсилає JSON
        update = await request.json();
      } catch {
        // якщо раптом не JSON — ігноруємо тихо, щоб не дропати вебхук
        return new Response("ok", { status: 200, headers: TEXT_HEADERS });
      }

      // Лог в тому ж форматі, який ти бачив у CF
      try {
        // коротко обрізаємо, щоб не засмічувати (опціонально)
        const pretty = JSON.stringify(update);
        console.log(`[webhook] raw update: ${pretty}`);
      } catch {
        // ignore
      }

      // Дістаємо базову інфу
      const msg = update?.message ?? update?.edited_message ?? null;
      const chatId: number | undefined = msg?.chat?.id;
      const text: string | undefined = msg?.text;

      // Немає що обробляти — підтверджуємо 200, щоб TG не ретраїв
      if (!chatId) {
        return new Response("ok", { status: 200, headers: TEXT_HEADERS });
      }

      // Обробка команд
      try {
        if (text === "/start") {
          await tgSend(env, chatId, "✅ Senti онлайн\nНадішли /ping щоб перевірити відповідь.");
        } else if (text === "/ping") {
          await tgSend(env, chatId, "pong ✅");
        } else {
          // за замовчуванням — нічого, але можна дати підказку
          // await tgSend(env, chatId, "Команда не підтримується. Спробуй /ping");
        }
      } catch (err) {
        console.error("[webhook] send error:", err);
        // повертаємо 200, аби TG не заспамив ретраями
      }

      return new Response("ok", { status: 200, headers: TEXT_HEADERS });
    }
    // ---------- /Telegram webhook end ----------

    // Фолбек
    return new Response("Not found", { status: 404, headers: TEXT_HEADERS });
  },
};

/** Надіслати повідомлення в TG */
async function tgSend(env: Env, chatId: number, text: string) {
  const token = env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is not set");
  const api = `https://api.telegram.org/bot${token}/sendMessage`;

  const body = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };

  const res = await fetch(api, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await safeText(res);
    throw new Error(`TG sendMessage HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json().catch(() => null);
  if (!data?.ok) {
    throw new Error(`TG sendMessage API error: ${JSON.stringify(data)}`);
  }
}

async function safeText(r: Response) {
  try { return await r.text(); } catch { return "<no body>"; }
}