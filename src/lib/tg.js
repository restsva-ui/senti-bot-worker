// Простий клієнт Telegram API для Workers
const API = (token) => `https://api.telegram.org/bot${token}`;
const FILE_API = (token) => `https://api.telegram.org/file/bot${token}`;

export async function tgSendText(env, chatId, text, opts = {}) {
  const url = `${API(env.BOT_TOKEN)}/sendMessage`;
  const body = { chat_id: chatId, text, parse_mode: "HTML", ...opts };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return await r.json();
}

export async function tgGetFileDirectUrl(env, fileId) {
  const info = await fetch(`${API(env.BOT_TOKEN)}/getFile?file_id=${encodeURIComponent(fileId)}`).then(r => r.json());
  if (!info.ok) throw new Error("getFile failed: " + JSON.stringify(info));
  const filePath = info.result.file_path; // e.g. photos/file_123.jpg
  return `${FILE_API(env.BOT_TOKEN)}/${filePath}`;
}