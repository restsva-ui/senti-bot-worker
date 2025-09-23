// index.js (Cloudflare Workers, ESM)

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('ok', { status: 200 });
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      // 1) Перевірка секрету від Telegram (якщо заданий)
      const got = request.headers.get('x-telegram-bot-api-secret-token');
      if (env.WEBHOOK_SECRET && got !== env.WEBHOOK_SECRET) {
        // Чітка відповідь — щоб відразу було видно причину в логах Telegrаm
        return new Response('unauthorized: bad secret', { status: 401 });
      }

      let update;
      try {
        update = await request.json();
      } catch {
        return new Response('bad json', { status: 400 });
      }

      // 2) Витягуємо chat_id та текст
      const chat =
        update?.message?.chat ||
        update?.edited_message?.chat ||
        update?.callback_query?.message?.chat ||
        null;

      const chatId = chat?.id;
      const text =
        update?.message?.text ??
        update?.edited_message?.text ??
        update?.callback_query?.data ??
        '';

      if (!chatId) {
        // Немає куди відповідати — ок для Telegram
        return new Response('no chat', { status: 200 });
      }

      // 3) Формуємо відповідь
      let reply;
      const norm = (text || '').trim();

      if (norm.startsWith('/start')) {
        // привітання українською (як ти хотів)
        reply = 'Vitaliy, привіт! ✨ Я вже чекав нашої зустрічі!';
      } else if (norm.length > 0) {
        reply = `Ти написав: ${norm}`;
      } else {
        reply = 'Я тут! Напиши щось 🙂';
      }

      // 4) Відповідаємо в Telegram
      const api = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;

      try {
        const tgResp = await fetch(api, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: reply,
            parse_mode: 'HTML',
          }),
        });

        if (!tgResp.ok) {
          // у разі помилки шлемо діагностику тим же чатом
          const errText = await tgResp.text().catch(() => '');
          await safeTell(chatId, `⚠️ sendMessage failed: ${tgResp.status} ${errText}`, env);
        }
      } catch (e) {
        await safeTell(chatId, `💥 fetch error: ${(e && e.message) || e}`, env);
      }

      // Telegram очікує 200 швидко
      return new Response('ok', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  },
};

// допоміжна — щоб не валити хендлер, якщо і це не вийде
async function safeTell(chatId, text, env) {
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (_) {
    // ігноруємо
  }
}
