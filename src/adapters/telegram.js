// Легка обгортка над Telegram Bot API, без змін існуючих імен
// Експорти залишені стабільними.

const TG_API = (token) => `https://api.telegram.org/bot${token}`;
const TG_FILE = (token) => `https://api.telegram.org/file/bot${token}`;

async function tgApiCall(env, method, payload) {
  const url = `${TG_API(env.TELEGRAM_TOKEN)}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data;
  try { data = await res.json(); } catch { data = { ok: false }; }
  if (!data.ok) {
    console.error(`TG API error: ${method} ${JSON.stringify(data)}`);
  }
  return data;
}

export async function tgSendMessage(chat_id, text, env, extra = {}) {
  return tgApiCall(env, "sendMessage", {
    chat_id,
    text,
    parse_mode: extra.parse_mode || "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

// залишаю і tgSendAction (попередньо збірка падала, коли його не було)
export async function tgSendAction(chat_id, action, env) {
  // typing | upload_photo | upload_document ...
  return tgApiCall(env, "sendChatAction", { chat_id, action });
}

export async function tgGetFileUrl(file_id, env) {
  // 1) getFile -> file_path
  const data = await tgApiCall(env, "getFile", { file_id });
  if (!data?.ok || !data.result?.file_path) return null;
  // 2) побудувати прямий URL завантаження
  return `${TG_FILE(env.TELEGRAM_TOKEN)}/${data.result.file_path}`;
}

// (не обов’язково, але хай буде утиліта відповіді)
export async function tgReply(chat_id, reply_to_message_id, text, env, extra = {}) {
  return tgSendMessage(chat_id, text, env, { reply_to_message_id, ...extra });
}