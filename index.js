const TG_BASE = 'https://api.telegram.org';

// простий JSON-відповідь
function json(d, s=200){
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

// відправка повідомлення в Telegram
async function tg(token, method, body){
  const url = `${TG_BASE}/bot${token}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text().catch(()=>'');
  console.log('Telegram call', {method, status: res.status, resp: text.slice(0,200)});
  return {status: res.status, text};
}

// перевірка секрету
function okSecret(req, exp){
  if (!exp) return true;
  const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  return !!got && got === exp;
}

// обробка апдейтів
async function handleUpdate(u, env){
  try {
    const m = u.message || u.edited_message || u.channel_post;
    if (!m?.chat?.id) return;
    const chat = m.chat.id;
    const text = (m.text || '').trim();
    const reply = text.toLowerCase() === 'ping' ? 'pong' : `Ти написав: ${text}`;

    if (!env.BOT_TOKEN){
      console.error('BOT_TOKEN missing in env');
      return;
    }
    await tg(env.BOT_TOKEN, 'sendMessage', { chat_id: chat, text: reply });
  } catch(e){
    console.error('handleUpdate error', String(e));
  }
}

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url);

    // health-чек
    if (req.method === 'GET' && url.pathname === '/health'){
      return json({
        ok: true,
        hasBOT_TOKEN: !!env.BOT_TOKEN,
        hasWEBHOOK_SECRET: !!env.WEBHOOK_SECRET
      });
    }

    // webhook
    if (req.method === 'POST' && url.pathname === '/webhook'){
      if (!okSecret(req, env.WEBHOOK_SECRET)){
        return json({ ok:false, error:'Bad secret' }, 401);
      }
      let upd;
      try { upd = await req.json(); }
      catch { return json({ ok:false, error:'bad json' }, 400); }

      ctx.waitUntil(handleUpdate(upd, env));
      return new Response('OK');
    }

    return new Response('Not found', {status:404});
  }
}