import { handleUpdate } from './router.js';
import { tgSetWebhook, tgDeleteWebhook } from './adapters/telegram.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Простий healthcheck
    if (request.method === 'GET') {
      return new Response('Senti worker alive', { status: 200 });
    }

    // Вебхук приймаємо на /:token (щоб було зручно ставити у BotFather)
    if (request.method === 'POST') {
      // НЕ блокуємо за секретом, якщо він не заданий (щоб не ламалось)
      // Якщо захочеш — додамо перевірку x-telegram-bot-api-secret-token
      let update;
      try {
        update = await request.json();
      } catch {
        return new Response('bad json', { status: 400 });
      }
      return handleUpdate(update, env);
    }

    return new Response('Not found', { status: 404 });
  },
};