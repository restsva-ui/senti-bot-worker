/**
 * Cloudflare Worker: Telegram webhook handler
 *
 * Потрібні secrets:
 *  - TELEGRAM_BOT_TOKEN
 *  - WEBHOOK_SECRET              // має збігатися з secret_token при setWebhook
 *
 * Маршрути:
 *  GET  /health  -> 200 "ok"
 *  GET  /        -> 200 короткий опис
 *  POST /webhook -> обробка апдейтів Telegram (із перевіркою секрету)
 */

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const TEXT_HEADERS = { "content-type": "text/plain; charset=utf-8" };

// Дрібні утиліти
const j = (obj, status = 200, headers = JSON_HEADERS) =>
  new Response(JSON.stringify(obj), { status, headers });
const t = (text, status = 200, headers = TEXT_HEADERS) =>
  new Response(text, { status, headers });

/** Відправка повідомлення у Telegram */
async function sendMessage(env, chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text, ...extra };

  // Тихий таймаут, щоб не зависати
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), 8000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      console.error("sendMessage failed", res.status, data);
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendMessage error", String(err));
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Перевірка секрету вебхука */
function verifyWebhookSecret(request, env) {
  const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
  const need = env.WEBHOOK_SECRET || "";
  return need.length > 0 && got === need;
}

/** Основна логіка обробки апдейтів */
async function handleTelegramUpdate(env, update) {
  // Підтримуємо лише звичайні повідомлення з текстом
  const msg = update?.message;
  const text = msg?.text?.trim();
  const chatId = msg?.chat?.id;

  if (!msg || !text || !chatId) {
    // Ігноруємо нецікаві апдейти (edited_message, callback_query, channel_post тощо)
    return { ignored: true };
  }

  // Команди
  if (text === "/start") {
    const hello =
      "Привіт! Я Senti 🤖\n" +
      "Надішли будь-який текст — я повторю його у відповідь.\n" +
      "Команди: /start, /ping";
    await sendMessage(env, chatId, hello);
    return { ok: true };
  }

  if (text === "/ping") {
    await sendMessage(env, chatId, "pong ✅");
    return { ok: true };
  }

  // Echo за замовчуванням
  await sendMessage(env, chatId, `echo: ${text}`);
  return { ok: true };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1) Healthcheck
    if (request.method === "GET" && url.pathname === "/health") {
      return t("ok");
    }

    // 2) Корінь — короткий опис
    if (request.method === "GET" && url.pathname === "/") {
      return t("Senti worker is running. Use POST /webhook for Telegram.");
    }

    // 3) Вебхук
    if (url.pathname === "/webhook") {
      if (request.method !== "POST") {
        return t("Method Not Allowed", 405);
      }

      // Перевірка секрету (обов'язково!)
      if (!verifyWebhookSecret(request, env)) {
        return t("Forbidden", 403);
      }

      let update;
      try {
        update = await request.json();
      } catch {
        return t("Bad Request", 400);
      }

      try {
        const result = await handleTelegramUpdate(env, update);
        // Telegram очікує 200 як підтвердження — без різниці, що в body
        return j({ ok: true, ...result });
      } catch (err) {
        console.error("handleTelegramUpdate error", String(err));
        // 200 все одно, щоб TG не ретраїв безкінечно; діагностику дивимось у логах
        return j({ ok: true, error: "internal" });
      }
    }

    // 4) Інші шляхи — 404
    return t("Not Found", 404);
  },
};