// src/index.js — DIAG MINIMAL (safe test)
// Не чіпаємо решту структури. Після тесту повернемо повний index.

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function ok(data = {}) {
  return new Response(JSON.stringify({ ok: true, ...data }), { headers: JSON_HEADERS });
}
function err(message, status = 500) {
  return new Response(JSON.stringify({ ok: false, error: String(message) }), {
    headers: JSON_HEADERS, status
  });
}

function apiBase(env) {
  // Дозволяємо міняти базу через змінну (у тебе вже є API_BASE_URL = https://api.telegram.org)
  return (env.API_BASE_URL || "https://api.telegram.org").replace(/\/+$/, "");
}

/** Мінімальний клієнт до Telegram Bot API (POST JSON) */
async function tg(env, method, body) {
  const base = apiBase(env);
  if (!env.BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
  const url = `${base}/bot${env.BOT_TOKEN}/${method}`;
  return fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** Безпечне читання JSON */
async function readJson(req) {
  try { return await req.json(); } catch { return null; }
}

/** Відіслати простий тестовий меседж у вказаний chat_id */
async function sendTest(env, chatId, text = "Test OK ✅") {
  if (!chatId) return;
  try {
    await tg(env, "sendMessage", { chat_id: chatId, text });
  } catch (e) {
    console.error("sendTest error:", e?.stack || e);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health / root
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/healthz")) {
      // Лишаємо знайоме повідомлення на корені (видно у тебе на скріні)
      if (url.pathname === "/") {
        return new Response("Hello from Worker!", { status: 200 });
      }
      return ok({ service: "senti-bot-worker", env: "ok" });
    }

    // Webhook endpoint: /webhook/<WEBHOOK_SECRET>
    if (url.pathname === `/webhook/${env.WEBHOOK_SECRET}`) {
      if (request.method !== "POST") return err("Method must be POST", 405);

      const update = await readJson(request);
      if (!update) return err("Invalid JSON", 400);

      // Витягуємо chat_id з різних типів апдейтів
      const chatId =
        update.message?.chat?.id ||
        update.edited_message?.chat?.id ||
        update.callback_query?.message?.chat?.id ||
        null;

      // Мінімальна перевірка /ping → "pong ✅", інакше — "Test OK ✅"
      const textIn = (update.message?.text || "").trim();
      const out = textIn === "/ping" ? "pong ✅" : "Test OK ✅";

      // Відправляємо тест
      await sendTest(env, chatId, out).catch((e) =>
        console.error("sendTest fail:", e?.stack || e)
      );

      // Миттєва відповідь Telegram, щоб не було ретраїв
      return ok({ received: true });
    }

    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  },
};