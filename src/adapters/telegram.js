// Minimal Telegram adapter
const API = (token) => `https://api.telegram.org/bot${token}`;

export async function tgSendAction(chatId, action, env) {
  await fetch(`${API(env.TELEGRAM_TOKEN)}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

export async function tgSendMessage(chatId, text, env, options = {}) {
  return fetch(`${API(env.TELEGRAM_TOKEN)}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      ...options
    }),
  });
}

export async function tgSendPhoto(chatId, url, caption, env) {
  return fetch(`${API(env.TELEGRAM_TOKEN)}/sendPhoto`, {
    method: "POST",
    body: JSON.stringify({ chat_id: chatId, photo: url, caption }),
    headers: { "Content-Type": "application/json" },
  });
}

// get HTTPS file URL by file_id
export async function tgGetFileUrl(fileId, env) {
  const r = await fetch(`${API(env.TELEGRAM_TOKEN)}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const j = await r.json();
  if (!j.ok) throw new Error("getFile failed");
  const path = j.result.file_path;
  return `https://api.telegram.org/file/bot${env.TELEGRAM_TOKEN}/${path}`;
}