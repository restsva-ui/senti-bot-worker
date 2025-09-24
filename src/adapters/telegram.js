// src/adapters/telegram.js
export async function tgSendMessage(chatId, text, env, extra = {}) {
  const token =
    env?.TELEGRAM_TOKEN ||
    (typeof TELEGRAM_TOKEN !== "undefined" ? TELEGRAM_TOKEN : "");
  const body = { chat_id: chatId, text, parse_mode: "HTML", ...extra };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("tgSendMessage fail", r.status, t);
  }
  return r.ok;
}

export async function tgSendChatAction(chatId, action = "typing", env) {
  const token =
    env?.TELEGRAM_TOKEN ||
    (typeof TELEGRAM_TOKEN !== "undefined" ? TELEGRAM_TOKEN : "");
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action }),
  }).catch(() => {});
}

export function tgGetFileUrl(filePath, token) {
  const t =
    token ||
    (typeof TELEGRAM_TOKEN !== "undefined" ? TELEGRAM_TOKEN : "");
  return `https://api.telegram.org/file/bot${t}/${filePath}`;
}