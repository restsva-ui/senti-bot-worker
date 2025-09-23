const json = (obj, init = {}) =>
  new Response(JSON.stringify(obj), {
    headers: { "content-type": "application/json;charset=utf-8" },
    ...init,
  });

const text = (body, init = {}) =>
  new Response(body, { headers: { "content-type": "text/plain" }, ...init });

const ok = (body = "ok") => text(body, { status: 200 });
const bad = (status = 400, msg = "bad request") => text(msg, { status });

async function tg(apiBase, method, payload) {
  const r = await fetch(`${apiBase}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`TG API ${method} ${r.status}: ${body}`);
  }
  return r.json();
}

function greet(name) {
  const who = name ? `, ${name}` : "";
  return `Привіт${who}! ✨ Я вже чекав нашої зустрічі!`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") return ok();

    const BOT_TOKEN = env.TELEGRAM_TOKEN;
    const WEBHOOK_SECRET = env.WEBHOOK_SECRET;
    if (!BOT_TOKEN) return bad(500, "TELEGRAM_TOKEN is missing");
    if (!WEBHOOK_SECRET) return bad(500, "WEBHOOK_SECRET is missing");

    const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

    // Set webhook manually
    if (request.method === "GET" && url.pathname === "/setwebhook") {
      if (url.searchParams.get("secret") !== WEBHOOK_SECRET)
        return bad(403, "forbidden");

      const hookUrl = `${url.origin}/webhook`;
      const res = await tg(API, "setWebhook", {
        url: hookUrl,
        secret_token: WEBHOOK_SECRET,
        allowed_updates: ["message"],
        max_connections: 40,
      });
      return json({ status: "ok", set_to: hookUrl, tg: res });
    }

    // Handle Telegram updates
    if (request.method === "POST" && url.pathname === "/webhook") {
      const got = request.headers.get("x-telegram-bot-api-secret-token");
      if (got !== WEBHOOK_SECRET) return bad(403, "forbidden");

      const update = await request.json().catch(() => null);
      if (!update) return bad(400, "no update");

      const msg = update.message;
      if (!msg) return ok();

      const chatId = msg.chat?.id;
      const textIn = (msg.text || "").trim();

      if (textIn === "/start") {
        const name = msg.from?.first_name || "";
        await tg(API, "sendMessage", { chat_id: chatId, text: greet(name) });
        return ok();
      }

      if (textIn === "/help") {
        await tg(API, "sendMessage", {
          chat_id: chatId,
          text: "Команди:\n/start — вітання\n/help — допомога",
        });
        return ok();
      }

      if (textIn) {
        await tg(API, "sendMessage", { chat_id: chatId, text: textIn });
      }
      return ok();
    }

    return bad(404, "not found");
  },
};
