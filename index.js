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

// ---------- AI providers ----------
// A) Workers AI (рекомендовано; Llama 3.1 8B — beta і наразі free) 
async function cfAi(env, prompt) {
  // модель у beta — безкоштовно, поки beta; далі — 10k neurons/доба free на акаунт
  // @cf/meta/llama-3.1-8b-instruct: якісна та швидка для чату
  const res = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role:'system', content:'Ти лаконічний, точний асистент.' }, { role:'user', content: prompt }],
  });
  // Workers AI повертає різні формати; нормалізуємо до text
  if (typeof res === 'string') return res;
  const txt = res?.response || res?.result || res?.text || '';
  return txt || '...';
}

// B) OpenRouter fallback (free-моделі, але з лімітами)
// Візьми легку безкоштовну модель — наприклад qwen3-14b:free (можеш підмінити на іншу :free)
async function openrouter(env, prompt) {
  if (!env.OPENROUTER_API_KEY) return null;
  const model = env.OPENROUTER_MODEL || 'qwen/qwen3-14b:free';
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://senti-bot-worker.restsva.workers.dev',
      'X-Title': 'senti-bot'
    },
    body: JSON.stringify({
      model,
      messages: [{ role:'system', content:'Ти лаконічний, точний асистент.' }, { role:'user', content: prompt }],
      temperature: 0.3
    })
  });
  const data = await r.json().catch(()=> ({}));
  if (!r.ok) {
    console.log('OpenRouter error', r.status, JSON.stringify(data).slice(0,400));
    return null;
  }
  return data.choices?.[0]?.message?.content?.trim() || null;
}

// Розумний виклик AI: спочатку Workers AI → якщо не вийшло, пробуємо OpenRouter
async function aiAnswer(env, prompt) {
  try {
    const ans = await cfAi(env, prompt);
    if (ans && ans !== '...') return ans;
  } catch(e) {
    console.log('cfAi failed:', String(e));
  }
  const fallback = await openrouter(env, prompt);
  return fallback || 'AI наразі недоступний. Спробуй ще раз пізніше.';
}

// ---------- business logic ----------
async function handleText(env, chat_id, text) {
  const t = text.trim();

  if (t === '/start') {
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id,
      text: 'Готовий! Команди:\n/help – довідка\n/ai <запит> – відповідь від AI (Workers AI; fallback OpenRouter)\nping – перевірка звʼязку'
    });
  }

  if (t === '/help') {
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id,
      text: 'Доступні:\n• ping → pong\n• /ai <запит> → AI-відповідь (безкоштовно через Workers AI beta)\n• Фото/файли/войс → підтвердження'
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
    const ph = msg.photo[msg.photo.length - 1];
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: `Фото отримано ✅\nfile_id: ${ph.file_id}\n${ph.width}×${ph.height}` });
  }
  if (msg.document) {
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: `Файл отримано ✅\n${msg.document.file_name||'document'} (${msg.document.mime_type||'mime?'})` });
  }
  if (msg.voice)   return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: `Войс отримано ✅ (${msg.voice.duration}s)` });
  if (msg.audio)   return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: `Аудіо отримано ✅ (${msg.audio.duration}s)` });
  if (msg.video)   return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: `Відео отримано ✅ (${msg.video.width}×${msg.video.height}, ${msg.video.duration}s)` });

  return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: 'Отримав медіа ✅' });
}

async function routeUpdate(env, update) {
  const msg = update.message || update.edited_message || update.channel_post;
  const chat_id = msg?.chat?.id;
  if (!chat_id) return;

  try {
    if (msg.text) return handleText(env, chat_id, msg.text);
    if (msg.photo || msg.document || msg.voice || msg.audio || msg.video) return handleMedia(env, msg);
  } catch (e) {
    console.error('routeUpdate error:', e?.stack || String(e));
    return tg(env.BOT_TOKEN, 'sendMessage', { chat_id, text: 'Сталася помилка, вже дивлюсь.' });
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/health') {
      return J({ ok:true, hasBOT_TOKEN: !!env.BOT_TOKEN, hasWEBHOOK_SECRET: !!env.WEBHOOK_SECRET, ai_workers:true, ai_openrouter: !!env.OPENROUTER_API_KEY });
    }

    if (req.method === 'POST' && url.pathname === '/webhook') {
      if (!okSecret(req, env.WEBHOOK_SECRET)) return J({ ok:false, error:'unauthorized' }, 401);
      let update; try { update = await req.json(); } catch { return J({ ok:false, error:'bad_json' }, 400); }
      console.log('Update:', JSON.stringify(update).slice(0, 1000));
      ctx.waitUntil(routeUpdate(env, update));
      return new Response('OK');
    }

    return new Response('Not found', { status:404 });
  }
}