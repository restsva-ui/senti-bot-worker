// index.js — Cloudflare Worker (Wrangler v4, nodejs_compat увімкнено)

export default {
  async fetch(request, env, ctx) {
    const { TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET } = env;

    // Простий healthcheck
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Прийом вебхука від Telegram
    if (url.pathname === '/webhook' && request.method === 'POST') {
      try {
        // 1) Перевірка секрету заголовка
        const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
        if (!WEBHOOK_SECRET || secretHeader !== WEBHOOK_SECRET) {
          // Відповідаємо 200, щоб Telegram не ретраїв безкінечно, але логуємо
          console.log('Bad secret header:', secretHeader);
          return new Response('ignored', { status: 200 });
        }

        // 2) Читаємо апдейт
        const update = await request.json().catch(() => ({}));
        // Легка діагностика в логах
        console.log('Update:', JSON.stringify(update));

        const message = update.message || update.edited_message || null;
        if (!message || !message.chat || !message.chat.id) {
          return new Response('no-message', { status: 200 });
        }

        const chatId = message.chat.id;
        const textIn = (message.text || '').trim();

        // 3) Формуємо відповідь
        let reply = '👋 Я живий! Надішли /start або будь-який текст.';
        if (textIn) {
          if (textIn === '/start') {
            reply = 'Привіт! Я Senti Worker. Напиши щось — я повторю. ✅';
          } else {
            reply = `Ти написав: «${textIn}»`;
          }
        }

        // 4) Відправляємо повідомлення назад у Telegram
        await sendMessage(env, chatId, reply);

        // 5) Завжди відповідаємо 200 швидко
        return new Response('ok', { status: 200 });
      } catch (err) {
        console.error('Webhook error:', err);
        // Telegram важливо отримати 200 навіть якщо у нас помилка
        return new Response('ok', { status: 200 });
      }
    }

    // 404 для інших маршрутів
    return new Response('Not found', { status: 404 });
  },
};

// Допоміжна функція для відправки повідомлень
async function sendMessage(env, chatId, text) {
  const api = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = new URLSearchParams();
  body.set('chat_id', String(chatId));
  body.set('text', text);

  const r = await fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('sendMessage failed', r.status, t);
  } else {
    // можна прибрати після дебага
    const j = await r.json().catch(() => ({}));
    console.log('sendMessage ok:', JSON.stringify(j));
  }
}