// index.js — Senti Telegram Worker (Cloudflare Workers / Wrangler v4)

// ---------- ЛОГИ ----------
function log(...args) {
  try { console.log(...args); } catch {}
}
function logErr(err, ctx = {}) {
  try {
    console.error(JSON.stringify({
      level: 'error',
      message: String(err),
      stack: err?.stack,
      ...ctx,
    }));
  } catch {}
}

// ---------- ХЕЛПЕРИ ----------
const ok = (body = 'ok', init = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    headers: { 'content-type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json' },
    ...init,
  });

const bad = (status = 400, message = 'bad request') => ok({ error: message }, { status });

function jsonParseSafe(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function tgApi(token) {
  const base = `https://api.telegram.org/bot${token}`;
  return {
    async call(method, payload) {
      const res = await fetch(`${base}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: data?.ok === true, data };
    },
    async sendMessage(chat_id, text, extra = {}) {
      return this.call('sendMessage', { chat_id, text, ...extra });
    },
    async setWebhook(url, secret_token) {
      return this.call('setWebhook', {
        url,
        secret_token,             // X-Telegram-Bot-Api-Secret-Token перевірка
        allowed_updates: ['message', 'edited_message', 'callback_query'],
        max_connections: 40,
        drop_pending_updates: false,
      });
    },
  };
}

function isTelegramRequest(req, expectedSecret) {
  // Перевірка секрету хедера, якщо заданий
  const got = req.headers.get('x-telegram-bot-api-secret-token');
  return expectedSecret ? (got && got === expectedSecret) : true;
}

// ---------- ГОЛОВНА ЛОГІКА ----------
export default {
  async fetch(request, env, ctx) {
    const { TELEGRAM_TOKEN, WEBHOOK_SECRET } = env;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const ray = request.headers.get('cf-ray');

    log('incoming', { path, method, ray });

    // Healthcheck
    if (method === 'GET' && (path === '/' || path === '/health')) {
      return ok('ok');
    }

    // Ручне встановлення вебхука з браузера/телефону:
    // GET /setwebhook?secret=<WEBHOOK_SECRET>
    if (method === 'GET' && path === '/setwebhook') {
      if (!TELEGRAM_TOKEN) return bad(500, 'TELEGRAM_TOKEN not set');
      const qsec = url.searchParams.get('secret');
      if (!WEBHOOK_SECRET) return bad(500, 'WEBHOOK_SECRET not set');
      if (!qsec || qsec !== WEBHOOK_SECRET) return bad(403, 'invalid secret');

      const hookUrl = new URL('/webhook', request.url).toString();
      const api = tgApi(TELEGRAM_TOKEN);
      const { ok: hookOk, data } = await api.setWebhook(hookUrl, WEBHOOK_SECRET);
      log('setWebhook', { hookUrl, hookOk, data });

      return hookOk ? ok({ ok: true, url: hookUrl, result: data.result })
                    : ok({ ok: false, error: data }, { status: 500 });
    }

    // Основний вебхук-ендпоїнт
    if (path === '/webhook') {
      if (method !== 'POST') return bad(405, 'method not allowed');
      if (!TELEGRAM_TOKEN) return bad(500, 'TELEGRAM_TOKEN not set');

      // Перевіряємо секретний заголовок телеграма
      if (!isTelegramRequest(request, WEBHOOK_SECRET)) {
        log('reject-webhook', { reason: 'bad secret header' });
        return bad(403, 'forbidden');
      }

      const textBody = await request.text();
      const update = jsonParseSafe(textBody) || {};
      log('update', { haveMessage: !!update.message, haveCallback: !!update.callback_query });

      try {
        const api = tgApi(TELEGRAM_TOKEN);

        // Повідомлення
        if (update.message) {
          const msg = update.message;
          const chatId = msg.chat?.id;
          const text = msg.text?.trim() || '';

          log('message', { chatId, text });

          if (!chatId) return ok(); // немає куди відповідати

          if (text === '/start') {
            await api.sendMessage(
              chatId,
              `Vitaliy, привіт! ✨ Я вже чекав нашої зустрічі!`
            );
            return ok();
          }

          if (text === '/setwebhook') {
            const hookUrl = new URL('/webhook', request.url).toString();
            const { ok: hookOk, data } = await api.setWebhook(hookUrl, WEBHOOK_SECRET);
            log('setWebhook-from-chat', { hookUrl, hookOk, data });

            await api.sendMessage(chatId, hookOk ? 'Вебхук встановлено ✅' : `Помилка вебхука ❌`);
            return ok();
          }

          // Ехо / базова відповідь (можеш замінити логікою бота)
          await api.sendMessage(chatId, `Ти написав: ${text}`);
          return ok();
        }

        // Callback query / інші типи апдейтів
        if (update.callback_query) {
          log('callback', { id: update.callback_query.id });
          return ok();
        }

        // Непідтримуваний тип апдейту — просто 200 OK
        return ok();
      } catch (err) {
        logErr(err, { where: 'webhook-handler' });
        return bad(500, 'handler error');
      }
    }

    // Якщо звернулись на інший шлях — 404
    return bad(404, 'not found');
  },
};

// ---------- ПРИМІТКИ ----------
// 1) У воркері мають бути секрети:
//    - TELEGRAM_TOKEN  (Actions -> передаємо у wrangler secret put)
//    - WEBHOOK_SECRET  (Actions -> передаємо у wrangler secret put)
// 2) Для зручної ініціалізації перейдіть в браузері на:
//    https://<твій-worker>.<твій-сабдомен>.workers.dev/setwebhook?secret=<WEBHOOK_SECRET>
// 3) Логи: Workers & Pages → твій воркер → Settings → Workers Logs → Enable.
//    Потім: Workers & Pages → твій воркер → Logs — побачиш записи з log()/logErr().
```0