// Легкий адаптер Telegram API для Worker

const apiBase = (env) => `https://api.telegram.org/bot${env.TG_BOT_TOKEN}`;
const fileBase = (env) => `https://api.telegram.org/file/bot${env.TG_BOT_TOKEN}`;

async function tgFetch(env, method, payload) {
  const res = await fetch(`${apiBase(env)}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error('TG API error:', method, data);
  }
  return data;
}

export async function tgSendMessage(env, chat_id, text, extra = {}) {
  return tgFetch(env, 'sendMessage', {
    chat_id,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

export async function tgSendAction(env, chat_id, action = 'typing') {
  return tgFetch(env, 'sendChatAction', { chat_id, action });
}

export async function tgAnswerCallback(env, callback_query_id, text, extra = {}) {
  return tgFetch(env, 'answerCallbackQuery', { callback_query_id, text, ...extra });
}

export function tgGetFileUrl(env, file_path) {
  return `${fileBase(env)}/${file_path}`;
}

export async function tgSetWebhook(env, url, secret) {
  const res = await fetch(`${apiBase(env)}/setWebhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: secret || undefined,
      allowed_updates: ['message', 'edited_message', 'callback_query'],
      max_connections: 40,
    }),
  });
  return res.json();
}

export async function tgDeleteWebhook(env) {
  const res = await fetch(`${apiBase(env)}/deleteWebhook`, { method: 'POST' });
  return res.json();
}