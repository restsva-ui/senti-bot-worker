// index.js — Cloudflare Workers (ES Modules)

const TG_BASE = 'https://api.telegram.org';

function json(data, init = 200) {
  return new Response(JSON.stringify(data), {
    status: typeof init === 'number' ? init : (init.status ?? 200),
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) }
  });
}

async function tgFetch(token, method, body) {
  const res = await fetch(`${TG_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telegram API ${method} failed: ${res.status} ${text}`);
  }
  return res.json();
}

function isTelegramVerified(request, expectedSecret) {
  if (!expectedSecret) return true; // дозволимо, якщо секрет не заданий (для локального тесту)
  const got = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  return got && got === expectedSecret;
}

// Проста логіка: відповідаємо на текст "ping" -> "pong", інакше — ехо
async function handleUpdate(update, env) {
  const msg = update.message || update.edited_message || update.channel_post;
  if (!msg || !msg.chat || typeof msg.chat.id !== 'number') return;

  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();

  let replyText = 'Привіт! Я на звʼязку ✅';
  if (text.toLowerCase() === 'ping') replyText = 'pong';
  else if (text) replyText = `Ти написав: ${text}`;

  await tgFetch(env.BOT_TOKEN, 'sendMessage', {
    chat_id: chatId,
    text: replyText,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Healthcheck
    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, name: env.WORKER_NAME || 'senti-bot-worker' });
    }

    // Webhook endpoint
    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (!isTelegramVerified(request, env.WEBHOOK_SECRET)) {
        return json({ ok: false, error: 'unauthorized' }, 401);
      }

      let update;
      try {
        update = await request.json();
      } catch {
        return json({ ok: false, error: 'invalid_json' }, 400);
      }

      // Відповідаємо Telegram миттєво, а роботу виконуємо у фоні
      ctx.waitUntil(handleUpdate(update, env).catch(err => {
        // лог у tail
        console.error('handleUpdate error:', err);
      }));

      return new Response('OK'); // швидкий 200
    }

    // Для зручності: показати, що воркер живий
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('Senti bot worker is running. Use /health or POST /webhook.');
    }

    return new Response('Not found', { status: 404 });
  }
};