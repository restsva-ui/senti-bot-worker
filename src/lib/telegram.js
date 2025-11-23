// src/lib/telegram.js
const API = "https://api.telegram.org";

export function escape(s = "") {
  return String(s).replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

export async function sendMessage(env, chatId, text, extra = {}) {
  const url = `${API}/bot${env.BOT_TOKEN}/sendMessage`;

  const body = {
    chat_id: chatId,
    text,
    parse_mode: extra.parse_mode || "MarkdownV2",
    ...(extra.reply_markup ? { reply_markup: extra.reply_markup } : {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(`Telegram API error sendMessage ${res.status} ${JSON.stringify(data)}`);
  }
  return data;
}