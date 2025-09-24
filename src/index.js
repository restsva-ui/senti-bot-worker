// src/index.js
// Повністю самодостатній файл для Cloudflare Workers.
// Крок 1: /healthz + безпечний вебхук із м'якою інтеграцією з ./router.js

// (не обов'язково, але якщо існує src/router.js — ми його підхопимо)
import * as Router from './router.js'; // безпечно: якщо немає потрібних експортів, використаємо fallback

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 1) Healthcheck (наш Крок 1)
    if (url.pathname === '/healthz') {
      return new Response('ok', { status: 200 });
    }

    // 2) Telegram webhook endpoint (м'який режим: або віддаємо в router, або echo)
    if (url.pathname === '/webhook' && req.method === 'POST') {
      // Перевірка секрету з setWebhook (якщо задано в env)
      const want = env.WEBHOOK_SECRET || '';
      const got = req.headers.get('x-telegram-bot-api-secret-token') || '';
      if (want && got !== want) {
        console.warn(JSON.stringify({ msg: 'bad secret', got }));
        return new Response('unauthorized', { status: 401 });
      }

      // Безпечний парсинг оновлення
      let update = null;
      try {
        update = await req.json();
      } catch {
        return new Response('bad json', { status: 400 });
      }

      // Якщо є твій роутер — делегуємо
      try {
        if (typeof Router.handleUpdate === 'function') {
          const res = await Router.handleUpdate({ update, env, ctx, req });
          // якщо твій хендлер уже повертає Response — віддамо як є
          if (res instanceof Response) return res;
        } else if (typeof Router.default === 'function') {
          const res = await Router.default({ update, env, ctx, req });
          if (res instanceof Response) return res;
        }
      } catch (e) {
        console.error('router error', e);
        // не падаємо — нижче є безпечний fallback
      }

      // Fallback: найпростіший echo тільки для текстових повідомлень
      if (update?.message?.text) {
        await tgSendMessage(env, update.message.chat.id, `Ти написав: ${update.message.text}`);
      }

      return new Response('ok', { status: 200 });
    }

    // 3) Все інше
    return new Response('not found', { status: 404 });
  }
};

// Допоміжні утиліти
async function tgSendMessage(env, chat_id, text, extra = {}) {
  const base = env.API_BASE_URL || 'https://api.telegram.org';
  const url = `${base}/bot${env.BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id, text, ...extra })
  });
  if (!res.ok) {
    const body = await safeText(res);
    console.error(JSON.stringify({ msg: 'telegram send failed', status: res.status, body }));
  }
  return res;
}
async function safeText(res) { try { return await res.text(); } catch { return ''; } }