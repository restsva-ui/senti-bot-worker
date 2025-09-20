const TG = 'https://api.telegram.org';

// ---------- utils ----------
const J = (d, s=200) => new Response(JSON.stringify(d), { status:s, headers:{'content-type':'application/json; charset=utf-8'} });

const okSecret = (req, exp) => !exp ? true : req.headers.get('X-Telegram-Bot-Api-Secret-Token') === exp;

async function tg(token, method, body) {
  const r = await fetch(`${TG}/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(body)
  });
  const text = await r.text().catch(()=> '');
  console.log('TG:', method, r.status, text.slice(0,200));
  if (!r.ok) throw new Error(`${method} ${r.status} ${text}`);
  try { return JSON.parse(text); } catch { return { ok:false, raw:text }; }
}

const chatIdFromUpdate = (u) => (u.message||u.edited_message||u.channel_post||{}).chat?.id;

// ---------- AI (опціонально через OPENAI_API_KEY) ----------
async function aiAnswer(env, prompt) {
  if (!env.OPENAI_API_KEY) return `AI вимкнено. Додай секрет OPENAI_API_KEY, тоді /ai відповідатиме.`;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type':'application/json', 'authorization': `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini', // можна змінити
      messages: [{ role:'user', content: prompt }],
      temperature: 0.3
    })
  });
  const data = await r.json();
  if (!r.ok) {
    console.log('OpenAI error', r.status, JSON.stringify(data).slice(0,400));
    return `Помилка AI: ${data.error?.message || r.status}`;
  }
  return data.choices?.[0]?.message?.content?.trim() || '...';
}

// ---------- business logic ----------
async function handleText(env, chat_id, text) {
  const t = text.trim();

  if (t === '/start') {
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id,
      text: 'Готовий! Команди:\n/help – довідка\n/ai <запит> – коротка відповідь від AI\nping – перевірка звʼязку'
    });
  }

  if (t === '/help') {
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id,
      text: 'Доступні:\n• ping → pong\n• /ai <запит> → відповідь від AI (якщо задано OPENAI_API_KEY)\n• Фото/док/войс → надсилаю підтвердження'
    });
  }

  if (t.toLowerCase() === 'ping') {
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: 'pong' });
  }

  if (t.startsWith('/ai ')) {
    const q = t.slice(4).trim();
    if (!q) return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: 'Напиши: /ai твій_запит' });
    await tg(env.BOT_TOKEN, 'sendChatAction', { chat_id, action: 'typing' });
    const ans = await aiAnswer(env, q);
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: ans });
  }

  // echo за замовчуванням
  return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: `Ти написав: ${t}` });
}

async function handleMedia(env, msg) {
  const chat_id = msg.chat.id;

  if (msg.photo?.length) {
    const ph = msg.photo[msg.photo.length - 1]; // найбільша
    return tg(env.BOT_TOKEN, 'sendMessage', {
      chat_id, text: `Фото отримано ✅\nfile_id: ${ph.file_id}\nрозмір: ${ph.width}×${ph.height}`
    });
  }
  if (msg.document) {
    return tg(env.BOT_TOKEN, 'sendMessage', {
      chat_id, text: `Файл отримано ✅\n${msg.document.file_name || 'document'} (${msg.document.mime_type||'mime?'}), size=${msg.document.file_size||'?'}B`
    });
  }
  if (msg.voice) {
    return tg(env.BOT_TOKEN, 'sendMessage', {
      chat_id, text: `Войс отримано ✅\nтривалість: ${msg.voice.duration}s`
    });
  }
  if (msg.audio) {
    return tg(env.BOT_TOKEN, 'sendMessage', {
      chat_id, text: `Аудіо отримано ✅\n${msg.audio.title || 'audio'}, ${msg.audio.duration}s`
    });
  }
  if (msg.video) {
    return tg(env.BOT_TOKEN, 'sendMessage', {
      chat_id, text: `Відео отримано ✅\n${msg.video.width}×${msg.video.height}, ${msg.video.duration}s`
    });
  }

  // якщо тип не підтримали, але апдейт не пустий
  return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: 'Отримав медіа ✅' });
}

async function routeUpdate(env, update) {
  const msg = update.message || update.edited_message || update.channel_post;
  const chat_id = msg?.chat?.id;
  if (!chat_id) return;

  try {
    if (msg.text) return handleText(env, chat_id, msg.text);
    // медіа-гілка
    if (msg.photo || msg.document || msg.voice || msg.audio || msg.video) {
      return handleMedia(env, msg);
    }
  } catch (e) {
    console.error('routeUpdate error:', e?.stack || String(e));
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: 'Сталася помилка, вже дивлюсь.' });
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // health
    if (req.method === 'GET' && url.pathname === '/health') {
      return J({ ok:true, hasBOT_TOKEN: !!env.BOT_TOKEN, hasWEBHOOK_SECRET: !!env.WEBHOOK_SECRET, ai: !!env.OPENAI_API_KEY });
    }

    // webhook
    if (req.method === 'POST' && url.pathname === '/webhook') {
      if (!okSecret(req, env.WEBHOOK_SECRET)) return J({ ok:false, error:'unauthorized' }, 401);
      let update; try { update = await req.json(); } catch { return J({ ok:false, error:'bad_json' }, 400); }
      console.log('Update:', JSON.stringify(update).slice(0, 1000));
      // негайна відповідь TG
      ctx.waitUntil(routeUpdate(env, update));
      return new Response('OK');
    }

    return new Response('Not found', { status:404 });
  }
}