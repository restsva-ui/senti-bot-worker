const TG_BASE = 'https://api.telegram.org';

function json(d, s=200){
  return new Response(JSON.stringify(d), {
    status:s,
    headers:{'content-type':'application/json; charset=utf-8'}
  });
}

async function tg(token, method, body){
  const url = `${TG_BASE}/bot${token}/${method}`;
  const res = await fetch(url, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify(body)
  });
  const text = await res.text().catch(()=> '');
  console.log('Telegram call', { method, status: res.status, resp: text.slice(0,200) });
  if (!res.ok) throw new Error(`${method} ${res.status} ${text}`);
  try { return JSON.parse(text) } catch { return { ok:false, raw:text } }
}

function okSecret(req, exp){
  if (!exp) return true;
  const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  return !!got && got === exp;
}

async function handleUpdate(u, env){
  try{
    console.log('Update', (JSON.stringify(u)||'').slice(0,500));
    const m = u.message || u.edited_message || u.channel_post;
    if (!m?.chat?.id){ console.warn('No chat id'); return; }
    const chat = m.chat.id;
    const text = (m.text||'').trim();
    const reply = text?.toLowerCase()==='ping' ? 'pong'
      : (text ? `Ти написав: ${text}` : 'Привіт! Я на звʼязку ✅');

    if (!env.BOT_TOKEN){ console.error('ENV BOT_TOKEN missing'); return; }
    await tg(env.BOT_TOKEN, 'sendMessage', { chat_id: chat, text: reply });
  }catch(e){
    console.error('handleUpdate error', String(e));
  }
}

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url);

    if (req.method==='GET' && url.pathname==='/health'){
      return json({
        ok:true,
        hasBOT_TOKEN: !!env.BOT_TOKEN,
        hasWEBHOOK_SECRET: !!env.WEBHOOK_SECRET
      });
    }

    if (req.method==='POST' && url.pathname==='/webhook'){
      if (!okSecret(req, env.WEBHOOK_SECRET)){
        console.warn('Bad secret');
        return json({ ok:false, error:'unauthorized' }, 401);
      }
      let upd; try { upd = await req.json(); }
      catch { return json({ ok:false, error:'bad_json' }, 400); }

      // важливо: миттєво 200, а роботу — у фон
      ctx.waitUntil(handleUpdate(upd, env));
      return new Response('OK');
    }

    return new Response('Not found', { status:404 });
  }
}