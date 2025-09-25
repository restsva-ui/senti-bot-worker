// src/index.js
import * as Router from './router.js';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // 0) DEBUG: показати, що є в env (секрети редагуються)
    if (url.pathname === '/debug-env') {
      const keys = Object.keys(env || {}).sort();
      const redacted = {};
      for (const k of keys) {
        const v = env[k];
        redacted[k] = typeof v === 'string'
          ? (v.length > 6 ? v.slice(0,3) + '…' + v.slice(-3) : '***')
          : typeof v;
      }
      return json({ ok: true, env_keys: keys, env_preview: redacted });
    }

    // 1) Healthcheck
    if (url.pathname === '/healthz') {
      return new Response('ok', { status: 200 });
    }

    // 2) KV test routes
    if (url.pathname === '/kv-test') {
      return handleKvTest(req, env);
    }

    // 3) Telegram webhook
    if (url.pathname === '/webhook' && req.method === 'POST') {
      const want = env.WEBHOOK_SECRET || '';
      const got = req.headers.get('x-telegram-bot-api-secret-token') || '';
      if (want && got !== want) {
        return new Response('unauthorized', { status: 401 });
      }

      let update = null;
      try { update = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

      // /start — привітання + запис у KV
      if (update?.message?.text === '/start') {
        const msg = update.message;
        const chatId = msg.chat.id;
        const user = msg.from || {};
        const lang = user.language_code || 'en';

        const greeting = lang.startsWith('uk')
          ? 'Привіт 👋! Я — Senti Bot. Я допоможу тобі працювати з AI та файлами.'
          : 'Hello 👋! I am Senti Bot. I will help you work with AI and files.';

        try {
          if (env.STATE && typeof env.STATE.put === 'function') {
            const key = `user:${user.id}`;
            const payload = {
              id: user.id,
              username: user.username || null,
              first_name: user.first_name || null,
              language_code: lang,
              started_at: new Date().toISOString()
            };
            await env.STATE.put(key, JSON.stringify(payload));
          }
        } catch (e) { console.error('kv put failed', e); }

        await tgSendMessage(env, chatId, greeting);
        return new Response('ok', { status: 200 });
      }

      // /me — показати, що збережено в KV
      if (update?.message?.text === '/me') {
        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;

        let txt = 'No KV bound. Add KV binding STATE to enable memory.';
        if (env.STATE && typeof env.STATE.get === 'function') {
          try {
            const raw = await env.STATE.get(`user:${userId}`);
            if (raw) {
              const data = JSON.parse(raw);
              txt = `Ваш профіль:\n• id: ${data.id}\n• імʼя: ${data.first_name || '—'}\n• мова: ${data.language_code}\n• start: ${data.started_at}`;
            } else {
              txt = 'Поки що даних немає. Надішли /start, щоб зберегти.';
            }
          } catch (e) { console.error('kv get failed', e); txt = 'Помилка читання KV.'; }
        }
        await tgSendMessage(env, chatId, txt);
        return new Response('ok', { status: 200 });
      }

      // Якщо є твій router.js — делегуємо
      try {
        if (typeof Router.handleUpdate === 'function') {
          const res = await Router.handleUpdate({ update, env, ctx, req });
          if (res instanceof Response) return res;
        } else if (typeof Router.default === 'function') {
          const res = await Router.default({ update, env, ctx, req });
          if (res instanceof Response) return res;
        }
      } catch (e) { console.error('router error', e); }

      // Fallback: echo
      if (update?.message?.text) {
        await tgSendMessage(env, update.message.chat.id, `Ти написав: ${update.message.text}`);
      }

      return new Response('ok', { status: 200 });
    }

    // 4) 404
    return new Response('not found', { status: 404 });
  }
};

// ---------- Helpers ----------
async function handleKvTest(req, env) {
  const url = new URL(req.url);

  if (!env.STATE || typeof env.STATE.get !== 'function') {
    return json({ ok: false, error: 'No KV binding STATE. Add it in Settings – Bindings.' }, 400);
  }

  // GET: або читання конкретного ключа, або list
  if (req.method === 'GET') {
    const key = url.searchParams.get('key');
    if (key) {
      const value = await env.STATE.get(key);
      return json({ ok: true, key, value }, 200);
    }
    // list режим
    const prefix = url.searchParams.get('prefix') || '';
    const limit = clampInt(url.searchParams.get('limit'), 100, 1, 1000);
    const cursor = url.searchParams.get('cursor') || undefined;
    const includeValues = url.searchParams.get('values') === '1';

    const list = await env.STATE.list({ prefix, limit, cursor });
    let items = list.keys.map(k => ({ name: k.name, expiration: k.expiration || null }));

    if (includeValues && items.length) {
      // обережно: по одному, щоб не лімітувати запит
      const out = [];
      for (const it of items) {
        const v = await env.STATE.get(it.name);
        out.push({ ...it, value: v });
      }
      items = out;
    }

    return json({
      ok: true,
      prefix,
      limit,
      count: items.length,
      list: items,
      cursor: list.list_complete ? null : list.cursor
    }, 200);
  }

  // DELETE: видалення ключа
  if (req.method === 'DELETE') {
    const key = url.searchParams.get('key');
    if (!key) return json({ ok: false, error: 'Missing ?key' }, 400);
    await env.STATE.delete(key);
    return json({ ok: true, deleted: key }, 200);
  }

  // POST: запис
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad JSON' }, 400); }
    const k = body?.key;
    const v = body?.value;
    if (!k) return json({ ok: false, error: 'Body.key required' }, 400);
    await env.STATE.put(k, typeof v === 'string' ? v : JSON.stringify(v ?? null));
    return json({ ok: true, saved: k }, 200);
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
function clampInt(n, def, min, max) {
  const x = parseInt(n, 10);
  if (Number.isFinite(x)) return Math.min(Math.max(x, min), max);
  return def;
}

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