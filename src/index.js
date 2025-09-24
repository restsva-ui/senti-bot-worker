// src/index.js
import * as Router from './router.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 1) Healthcheck
    if (url.pathname === '/healthz') {
      return new Response('ok', { status: 200 });
    }

    // 2) Telegram webhook
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const want = env.WEBHOOK_SECRET || '';
      const got = req.headers.get('x-telegram-bot-api-secret-token') || '';
      if (want && got !== want) {
        return new Response('unauthorized', { status: 401 });
      }

      let update = null;
      try {
        update = await req.json();
      } catch {
        return new Response('bad json', { status: 400 });
      }

      // --- НОВЕ: обробка /start ---
      if (update?.message?.text === '/start') {
        const chatId = update.message.chat.id;
        const lang = update.message.from?.language_code || 'en';

        let greeting;
        if (lang.startsWith('uk')) {
          greeting = 'Привіт 👋! Я — Senti Bot. Я допоможу тобі працювати з AI та файлами.';
        } else {
          greeting = 'Hello 👋! I am Senti Bot. I will help you work with AI and files.';
        }

        await tgSendMessage(env, chatId, greeting);
        return new Response('ok', { status: 200 });
      }
      // --- END ---

      // Якщо є твій router.js — пробуємо делегувати
      try {
        if (typeof Router.handleUpdate === 'function') {
          const res = await Router.handleUpdate({ update, env, ctx, req });
          if (res instanceof Response) return res;
        } else if (typeof Router.default === 'function') {
          const res = await Router.default({ update, env, ctx, req });
          if (res instanceof Response) return res;
        }
      } catch (e) {
        console.error('router error', e);
      }

      // Fallback: echo
      if (update?.message?.text) {
        await tgSendMessage(env, update.message.chat.id, `Ти написав: ${update.message.text}`);
      }

      return new Response('ok', { status: 200 });
    }

    return new Response('not found', { status: 404 });
  }
};

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