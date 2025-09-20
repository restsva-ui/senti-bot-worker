// index.js — стабільний echo з докладним логуванням
const TG_BASE = 'https://api.telegram.org';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

async function tgFetch(token, method, body) {
  const url = `${TG_BASE}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  // лог на всяк
  console.log('Telegram call:', { method, status: res.status, body, resp: text.slice(0, 300) });
  if (!res.ok) throw new Error(`Telegram ${method} failed: ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return { ok: false, raw: text }; }
}

function okSecret(req, expected) {
  if (!expected) return true;
  const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  return got && got === expected;
}

async function handleUpdate(update, env) {
  try {
    console.log('Update:', JSON.stringify(update).slice(0, 1000));
    const msg = update.message || update.edited_message || update.channel_post;
    if (!msg?.chat?.id) { console.log('No chat id'); return; }

    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();
    const reply = text?.toLowerCase() === 'ping'
      ? 'pong'
      : text ? `Ти написав: ${text}` : 'Привіт! Я на звʼязку ✅';

    await tgFetch(env.BOT_TOKEN, 'sendMessage', { chat_id: chatId, text: reply });
  } catch (e) {
    console.error('handleUpdate error:', e?.stack || String(e));
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, name: env.WORKER_NAME || 'senti-bot-worker' });
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      if (!okSecret(request, env.WEBHOOK_SECRET)) {
        console.warn('Bad secret header');
        return json({ ok: false, error: 'unauthorized' }, 401);
      }
      let update;
      try { update = await request.json(); }
      catch { return json({ ok: false, error: 'invalid_json' }, 400); }

      // миттєво віддаємо 200, роботу — у фон
      ctx.waitUntil(handleUpdate(update, env));
      return new Response('OK');
    }

    return new Response('Not found', { status: 404 });
  }
};